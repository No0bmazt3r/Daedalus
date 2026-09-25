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
- [x] **Settings → Search**, the setup surface for finding that corpus. Six
      providers (SearXNG · DuckDuckGo · Brave · Google PSE · Tavily · Serper)
      with an ordered fallback chain, per-provider credentials, a Test probe and
      a live search that shows every attempt the chain made. Ported from the
      Odysseus Search tab.
      - [x] Rule 1 held in the schema, not in good intentions:
            `search_config.purpose` CHECKs to `'setup'`, nothing on the chat
            path imports `services/web_search.py`, and §8.2's line for model
            weights — downloading is setup, the runtime stays offline — is the
            same line drawn for documents
      - [x] Credentials get 002's three protections: a masked `key_hint`
            instead of the key, one obviously-named `secret_for()` accessor, and
            `prefs` absent from `log_browser.BROWSABLE` so the raw viewer cannot
            render either table
      - [x] Three deliberate departures from Odysseus: no implicit DuckDuckGo
            fallback (a second provider is a second party seeing the query), a
            failing provider states its reason rather than returning an empty
            list that reads as "no results", and the chain's attempts are in the
            response so a fallback is watched rather than inferred
      - [x] **SearXNG is containerised**, behind `--profile with-search` on
            `127.0.0.1:8081` — the one provider where the query reaches a
            process on this machine instead of a company with a log of it.
            Behind a profile rather than in the default stack because Rule 1
            says the runtime is offline: it is started while sourcing the
            corpus and stopped afterwards. 8081 because Odysseus holds 8080 on
            the same machine, the same reason ChromaDB moved off 8000
      - [x] Its engine list is tuned from measurement, not from the defaults.
            From behind NAT, Brave, DuckDuckGo and Startpage all returned
            `Suspended` or `CAPTCHA`, and Bing answered a reactor query with
            Gmail help pages — worse than nothing, because nothing is honest.
            Crossref, OpenAlex and Semantic Scholar answer over real APIs, do
            not block a datacentre address, and are the right index for
            manuals and standards anyway. SearXNG's general defaults stay
            enabled underneath for a network that is not blocked
      - [x] DuckDuckGo is parsed with the standard library's `html.parser`
            rather than BeautifulSoup — it is the only HTML this backend reads,
            and its redirector is unwrapped only after checking the host, which
            is otherwise an open redirect
- [x] **The pipeline is built** — `services/{extraction,chunking,ingestion,corpus_config}`,
      `db/corpus_store`, `api/corpus.py`, and Blueprints → Corpus → Build as the
      operating surface. Upload → extract → chunk → embed → Chroma, as one
      orchestrated run with a level-tagged log per stage. What remains is the
      corpus itself, not the machinery
  - [x] Extract text — TXT, MD, CSV, JSON, YAML now; **PDF via `pypdf`**, which
        is an optional import listed in `requirements.txt`, so a machine without
        it still boots and refuses a PDF with a message naming the package.
        Deliberately no OCR: a scanned PDF has no text layer and is refused with
        that reason rather than stored as a document whose chunks are blank
  - [ ] DOCX. Not wired — `python-docx` would be a second optional import, and
        no document in the intended corpus is a .docx yet
  - [x] Clean: line endings, PDF ligatures, non-breaking spaces, runs of blank
        lines. Done in the extractor rather than the chunker because it changes
        offsets, and every offset the extractor reports must describe the string
        it returns
  - [x] Chunk **section-aware**, with the strategy configurable — `recursive`
        (paragraph → line → sentence → word) is the default, `paragraph` never
        splits one, and `fixed` is kept as the naive baseline the comparison may
        want. Sizes are characters, and tokens are estimated at 4 chars and
        labelled as estimates; counting real ones needs the embedding model's
        tokenizer, which would break preview before a model is pulled
  - [x] Tag metadata: `chunk_id`, `source_file`, `source_type`, `section_title`,
        `page_number`, `document_version`, `reactor_mode` — written to both the
        manifest and the Chroma vector, since `search_corpus` filters and cites
        on them
  - [x] Local embeddings, by the **selected** model rather than a default one.
        Chroma is never allowed to embed: it would use its own bundled MiniLM,
        put those vectors in a collection stamped `nomic-embed-text`, and make
        every score meaningless with nothing on screen to say so
  - [x] The same chunks feed both tracks by construction — one corpus, one
        manifest, and the graph track joins to it by `source_file`. No frozen
        `corpus_chunks.json`: the manifest **is** the freeze, it is queryable,
        and every run records the recipe that produced it on the run row
  - [ ] Target ≥80 chunks (200+ is stronger) — waits on the corpus

### Embedding model selection  ▸ Layer 4 prerequisite

Built ahead of M2 because it needs no documents — the same reasoning that built
the Forge while M5 was in flight.

- [x] `services/embedding_models.py` — catalogue of the four local models from
      `architecture/04` Step 5 with the two figures ingestion needs (vector
      width, context window), plus detection of what is installed. Capability
      comes from Ollama's own `/api/show`, not from name-matching, so a model
      pulled outside the catalogue is still found
- [x] Pull via SSE — an embedding model is an Ollama model, so this is the
      Forge's existing mechanism on a surface that suits the decision
- [x] **The one-way door.** The config records which model actually built the
      index (`indexed_with`), so selecting a different one reports `stale`
      rather than silently returning results ranked by comparing vectors from
      two different spaces. Verified across empty → current → stale → current
- [x] **Cloud embeddings are quarantined, not offered as a peer.** Rule 1 allows
      cloud models as offline baselines; embeddings expose far more than a chat
      turn, because the corpus goes out at ingest *and* every later query must
      be embedded by the same model to be comparable. So a cloud selection
      writes a separate collection and `resolve_for_runtime()` refuses it
- [x] **Embedding models are their own tier in the Forge.** Tiering was `slm`
      under 4B params and `llm` over, which was correct while every installed
      model was generative. `nomic-embed-text` is 137M, so it landed in `slm` —
      the tier the deployment picks from — carrying a fit verdict and a quality
      score computed on a scale that does not apply to it
- [x] **`model_config.resolve()` filters on capability.** auto mode ranked every
      installed model with no capability check, so on a machine holding only an
      embedding model it would have selected it and the chat path would have
      asked an embedder for a completion. Filters on the *presence* of
      `completion` rather than the absence of `embedding`, so a model reporting
      neither is excluded rather than assumed usable. Verified across four
      cases, including an embedder out-scoring a chat model
- [x] The three auto-resolve failures now read differently — nothing installed,
      nothing fits, and "fits but cannot generate text" sent the reader to the
      wrong fix when they shared one message
- [x] **Embedding models live in the Forge, not in Settings.** They were first
      put beside the retrieval-track switch, on the reasoning that the choice is
      inseparable from the index it produced. True, and still the wrong home:
      the Forge is the model console and this is a model, so splitting "models
      you pull" across two windows by what the model is *for* left neither
      window able to answer "what is on this machine". The Forge now owns the
      lifecycle — Models → Embeddings discovers and pulls, Added Models →
      Embedding models is the inventory and the selection
- [x] Settings → Knowledge Base keeps only the corpus fact: whether the stored
      vectors were produced by the selected model. Read-only, because a stale
      index is fixed by re-ingesting rather than by changing a setting
- [x] **Embedding figures are measured, not declared, once pulled.** The
      catalogue's dimensions and context window were shown bare, which broke the
      rule `model_fit.py` already follows for weight size: a claim about a
      published tag and a fact read off the file on this disk must not look
      alike (`MODULES.md` §2.2). `local_models()` now reads
      `<arch>.embedding_length` and `<arch>.context_length` from Ollama's
      `/api/show` for anything installed, falls back to the catalogue otherwise,
      and every row reports which source answered. Family, parameter size and
      quantization come the same way
- [x] A consequence worth having: an embedding model the catalogue never
      declared still gets complete figures, because they are read from the file
      rather than looked up
- [x] **Verified dimensions.** `POST /api/embeddings/verify` embeds a fixed
      probe string and records the width that actually comes back — the only
      figure that is ground truth for what a vector store receives, because
      `/api/show` reports what the *architecture* declares and a model with
      Matryoshka truncation or an unusual pooling config can emit something
      narrower. Three tiers now, never conflated: `declared` < `measured` <
      `verified`. A disagreement is shown, not silently resolved, and every
      derived figure recomputes from the verified width
- [x] `ollama_client.embed()` — the only call in that client that runs a model
      rather than reading metadata about one. Handles both the current
      `/api/embed` response shape and the older flat `embedding` key, because
      the failure is otherwise an empty vector reported as 0 dimensions
- [x] **One collection per embedding model.** `collection_name()` derives
      `daedalus_knowledge__<tag>` from the selection, so changing models
      addresses a different index rather than corrupting the current one, and
      changing back finds the old vectors intact. The width is deliberately not
      in the name: a tag is known at selection, a verified width may only arrive
      later, and putting it there would rename a collection out from under an
      index that already existed. Clamped to Chroma's 63-character limit, with a
      hash of the full tag when a name would overrun it
- [x] **The index is stamped with what built it.** `record_index()` writes the
      model onto the collection's own metadata *before* writing it to the
      config. The collection is the authority because it survives a config
      restored from git and a `data/chroma` copied between machines; the config
      is the cache that still answers when Chroma is down, and `index_source`
      says which one answered
- [x] **The query path refuses an index it cannot attribute.**
      `vector_store.get_collection()` checks the stamp and raises
      `IndexMismatch`, with `require_match=True` as the default so retrieval
      written later inherits the guard instead of having to remember it. An
      empty collection is safe; documents with no stamp are not. The raw browser
      is the one caller that opts out, because showing an index nothing may
      query is its whole job
- [x] `index_state` gained `unknown` — Chroma could not be read, so nothing was
      established. An absence of a verdict rather than a verdict, and the normal
      state on this machine without the container running
- [x] The cloud quarantine became real rather than declared. `vector_store`
      hardcoded `daedalus_knowledge` and never read the `collection` the config
      set, so a configured cloud embedder would have written its vectors into
      the local production index
- [ ] Ingestion must call `record_index()` when it finishes, or nothing can
      attribute the index: `index_state` stays `stale` and the query path
      refuses to retrieve from it
- [ ] Warn when a chunk exceeds the selected model's context window. The UI
      flags a narrow window against M2's 300-500 token chunks, but only
      ingestion can know whether a chunk actually overran

## M3 — Deterministic tool layer  ▸ Layer 8

### The registry and the five non-sensor categories  ▸ built

- [x] `services/agent_tools/` — 13 tools across `search` · `knowledge` ·
      `session` · `system` · `other`, and a dispatcher that validates three
      declarations before the function is entered. Informed by Odysseus'
      `src/agent_tools/` + `tool_capabilities.py`, not ported from them: the
      effect vocabulary differs because the two systems are afraid of different
      things — Odysseus guards a workspace and a mailbox, this guards a rule
      that no number may be invented and nothing may leave the machine
- [x] **The surface gate is Rule 1 and Rule 5 in code.** A tool declaring
      `network_egress`, `write` or `admin` is refused on the runtime surface,
      so a web search tool cannot reach the chat path however the prompt is
      worded. Verified against a tool that raises on entry: refused without
      running
- [x] **Arguments are validated, not coerced.** `Param` carries type, enum and
      bounds; an unknown argument name is an error rather than a silent drop,
      because `sensor_name` for `sensor` is a misunderstanding worth surfacing.
      §7.2's "whitelisted, parameterized" at the boundary
- [x] **`citable` is Rule 3 at the tool boundary.** Session tools return
      `transcript` integrity and are never citable: §7.4's hazard is that turn 3
      said "CO₂ is 470.2 ppm" and turn 9 can still see it. Marking it here is the
      only moment the distinction exists — later, both are just strings
- [x] **`render_for_prompt()` fences untrusted content** with a nonce-tagged
      marker naming what it is. A RAG system's shape is "read text somebody else
      wrote, put it in front of a model", and a fixed delimiter is one a hostile
      document can contain and close. Tested with a passage carrying a forged
      closing marker
- [x] Every dispatch writes a `tool_logs` row with arguments, status and
      latency — §7.1 step 11, which nothing wrote before
- [x] Settings → Agent Tools renders the catalogue, runs any tool with a person
      watching, and lists what is **deliberately** not offered with the rule
      that excludes it
- [x] **All of it offered, and lockable.** All four effects ship open:
      single-operator console, the operator is the admin, and four confirmation
      clicks between somebody and their own tools protect nobody
      - [x] **The default is now schema, not a seed (006).** 005 seeded four
            "unlocked" rows, which works exactly once — *lock all* deletes them,
            a migration runs a single time, and the console silently reverts to
            fully-refused. Caught by the running stack reporting 0 unlocked
            after an earlier test had locked everything. `tool_locks` stores what
            is **closed**, so empty means open and restoring the default is an
            idempotent delete
      - [x] The panel's header reads `catalogue.locked` rather than the static
            `forbidden_at_runtime` set — it was announcing "admin, execute_code,
            network_egress, write are refused" while all four were open
- [x] The rest of the "not offered" list built: `manage_endpoints`' write half
      (keys write-only — no action returns a credential), `chat_with_model`
      (local tags only, model recorded), `pipeline` (each step re-enters the
      gate and gets its own log row), `manage_memory` (writes to `memory_logs`
      in the audit DB, which neither retrieval track reads; `forget` expires
      rather than deletes), and `ui_control` (`open_panel` returns an intent the
      UI may decline). 26 tools
- [x] **MCP implemented** — stdio and http transports, written in-house
      (`services/mcp_client.py`) because the three methods needed are three
      JSON-RPC calls and the dependency would not get them more right; the care
      went into process handling instead. One session per call: no pooling, no
      orphans, every failure attributable
      - [x] **Pinning is the answer to §7.2 and §5.** A server declares its own
            tools and can change them; `pin` writes the list down and hashes it,
            every connection compares, drift is named (*"added
            delete_everything"*), an unpinned server cannot be called at all,
            and a tool outside the snapshot is refused
      - [x] **One proxy, not N registered tools.** `mcp_call` declares the honest
            worst case — `network_egress` + `execute_code` + `write` — so a
            runtime-discovered tool never bypasses a gate that reviews effects
            beforehand. Locking any one of the three closes MCP entirely
      - [x] Adding a server is an operator action in Settings → Integrations,
            never a tool: a model able to write that row could name any
            executable on the machine
      - [x] Settings → Integrations built (was a placeholder), following the
            Odysseus panel's shape — one list, one add button — with test, pin,
            enable and delete per server, and drift called out where it happens
      - [x] Verified against a real stdio server: handshake · pin · call ·
            unpinned refused · drift detected and the new tool refused · bad JSON
            rejected · unknown label lists what exists · disabled refused ·
            `execute_code` lock closes MCP while `mcp_list_servers` still answers
- [x] **Extended capabilities — built, and gated.** The web,
      session-write, configuration and execution tools now exist
      (`agent_tools/extended/`), locked behind four effects: `network_egress`,
      `write`, `admin`, `execute_code`. All four closed is the default and the
      configuration §3 describes
      - [x] The reasoning: a rule you have never tested is a belief. "The agent
            could have searched the web and here is what it did to groundedness"
            is a result; "we never built it" is an assumption. The requirement is
            that the capability never arrives *quietly* — so an unlock is
            deliberate, carries a stored reason, is stamped onto every catalogue
            response, and the panel warns while anything is open
      - [x] An unlock lifts the refusal and nothing else. Validation still runs,
            `tool_logs` still records every call, and the containment inside each
            tool has no switch: a workspace root resolved *after* symlinks, an
            environment scrubbed to PATH/HOME/LANG, a timeout that kills the
            process group, output and size caps, and an SSRF guard that re-checks
            the host after every redirect
      - [x] Session writes are labelled rather than prevented — the transcript
            stays honest by attribution. `manage_settings` is a whitelist of one
            key and still refuses a frozen track. `manage_endpoints` is read-only
      - [x] The denylist is documented as what it is: a list of the ways somebody
            already thought of. It is not a sandbox, and the module says so — the
            real boundaries are the lock and the container
      - [x] Verified: locked tools refuse before entry · an unlock with no reason
            is rejected · eight composed denylist probes blocked, ordinary
            commands pass · six `../` segments refused · the child sees six env
            vars and no credentials · `web_fetch` refuses loopback, localhost,
            link-local metadata and non-HTTP schemes · the advertised schema list
            grows 13 → 16 only when `write` is unlocked
- [ ] The sensor tools (`get_live_reading` · `get_trend` ·
      `get_anomaly_summary`) are still the rest of this milestone. They read the
      telemetry of record and want their own module and review; the registry
      already carries a `READ_SENSOR` effect so adding them is a registration
      rather than a redesign

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
- [x] SSE streaming for token-by-token output — `POST /api/chat` yields one
      frame per token. The model call runs on a worker thread, so a generation
      outlives the request that started it and a client that navigated away can
      rejoin via `GET /api/chat/{id}/status`
- [ ] Tests: every unsafe phrasing is refused · a response containing an invented number is caught · a stale number replayed from history is caught

## M6 — Retrieval tracks  ▸ Layer 5

### Track 1 — Traditional vector RAG

> Readiness now means `index_state: current`, not "has rows". An index built by
> a different embedding model, or by something that never recorded itself,
> cannot answer — so counting it as ready would put an arm into §5's comparison
> that cannot run.

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
- [x] One collection per embedding model, stamped with what produced it, and a
      `get_collection()` guard that refuses vectors it cannot attribute — so a
      local index and a cloud baseline over the same corpus coexist and stay
      comparable instead of overwriting each other
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
- [x] Benchmark runner on a RAG-sized prompt, with a warm-up pass. Streams
      progress (SSE) so a multi-minute run shows what it is doing. Methodology
      and its limitations written up in [`docs/BENCHMARK.md`](docs/BENCHMARK.md)
- [x] **Start the TTFT clock on the first token of *either* kind.** Ollama streams
      a reasoning model's chain of thought in `thinking` and leaves `response`
      empty until it finishes. Watching only `response` recorded **no TTFT at
      all** for qwen3 and gpt-oss — both reasoning models, and both of this
      project's actual candidates — so Objective 3's headline metric was NULL on
      2 of the first 4 successful runs
- [x] **Benchmark cloud tags, tagged apart from local ones.** `source='benchmark_cloud'`
      (migration `003` records the vocabulary), warm-up skipped, and the prompt
      forced to the fixture so a cloud call never carries real plant documents
      off the machine
- [x] Write the selection to `config/model_config.json`
- [x] **Forge reorganised by kind of model** — tabs are now Hardware · Chat
      models · Embedding models · Cloud baselines, replacing Models + Added
      Models. The seven source tabs became filters on one list (Shortlist /
      Everything, Installed, SLM / LLM, Runnable only); one card per model with
      the quantisation picked on it, so the shortlist counts 6 rather than 15;
      Hugging Face and typed tags moved under the list, searched only on request;
      run statistics (p50/p95) moved into each card's detail. The shortlist is
      editable by starring, stored in prefs as edits against the report's six,
      which keep a "report candidate" badge. Settings → Added Models now opens
      the same list with Installed on
- [x] **Hugging Face is a third scope** beside Shortlist and Everything — the
      search box searches it (debounced) only while it is chosen, so choosing it
      is the consent to send the query off the machine. "Check tag" sits beside
      the search box whenever a tag is pasted, in any scope
- [x] **Embedding catalogue: 4 → 16 models**, every figure read from the tag's
      own GGUF header on registry.ollama.ai (width, context) and its manifest
      (size) on 2026-09-25. Adds Arctic Embed 2 / L / M-Long / S, Granite 30M /
      278M, EmbeddingGemma, Qwen3 Embedding 0.6B / 4B / 8B, BGE Large, Paraphrase
      Multilingual. **Corrected** nomic-embed-text's context from 8,192 (model
      card) to 2,048 (what Ollama's file declares). The tab gained filters
      (All / Installed / English / Multilingual, plus a name filter) and a
      pull-any-tag box that says so when the pulled model is not an embedder.
      Fixed selection matching, which cut every tag at `:` and would never have
      marked `snowflake-arctic-embed:335m` as selected
- [x] **Installed tab restored, browse tabs made browse-only.** Forge tabs are
      Hardware · Installed · Chat models · Embedding models. Installed manages
      (local models with run history, benchmark, delete; embedding selection,
      verify and the index state; cloud baselines). The two model tabs only
      search, filter, pull and star; an installed card shows Manage, which
      switches to Installed, so each control has one home. Settings → Added
      Models renders the same Installed view
- [x] **Embedding catalogue moved to `backend/app/data/embedding_catalogue.json`**,
      beside `model_catalogue.json` and loaded the same way — read fresh per call,
      a malformed file degrades to no suggestions rather than an error
- [ ] Average the benchmark over several runs — currently one run per click.
      `GET /api/forge/usage` already aggregates every logged run into
      mean/p50/p95, so this is about the *per-click* figure, not the report's.
      **The measured spread makes this matter**: live TTFT for the same model and
      prompt ranged 3,399 ms to 13,432 ms (4×), driven by cold loads. No figure
      in the report may be a single run — see `BENCHMARK.md` §9.1
- [x] Record *which* host served a run — `model_logs.host` (migration `004`),
      `ollama.com` for a cloud row and NULL for local. Host only, never a full URL:
      a base URL can carry a key and these rows are exported. It groups runs; it
      does not identify the GPU behind the host, which Ollama does not disclose
      (`BENCHMARK.md` §9.4)
- [ ] Cross-check estimates against LLM Checker for the methodology chapter.
      Worth doing now that there is something to check: on the development
      machine the estimator predicted 28.9 tok/s against 27.9 measured
- [ ] *Optional:* Streamlit UI — unlikely; the web console covers it

## M10 — Dashboard completion  ▸ Layer 9B

- [x] Wire the chat UI to `POST /api/chat` — no longer mocked
- [x] SSE streaming rendering — tokens append as they arrive; `lib/http.ts`
      `streamEvents()` owns the framing for both streaming endpoints
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
    - [x] **Architecture on the inventory card too.** The block the Models tab
          shows under its memory estimate (layers · attn heads · KV heads · head
          dim · hidden size) moved to `ui/model-architecture.tsx` and now renders
          on Added Models as well, behind the same chevron the Models rows use so
          a list of cards stays scannable. Never for an embedding model: its
          `hidden size` is a plausible-looking number that is *not* the width the
          vector store receives, and the verified width in the Embedding pane is
          the only figure that is. `head dim` gained a hint saying the same, since
          it is the field that reads like a retrieval dimension and is not one
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
  - [x] **Labyrinth Blueprints** — both halves built. Storage decision settled:
        NetworkX over a git-tracked YAML
        source of truth (MODULES.md §3.4's recommendation), so the store count
        stays at five
    - [x] Hand-authored graph — `backend/app/data/graph/knowledge_graph.yaml`,
          37 nodes and 48 edges across all 7 node and 7 edge types, authored
          against the real `sensor_readings` columns so a graph `Sensor` node
          and a telemetry tool call name one thing
    - [x] Loader with schema validation — `services/knowledge_graph.py`. Refuses
          a graph that does not validate rather than serving a subtly broken
          one: a typo'd edge type is not a crash, it is a silent retrieval
          failure. `python -m app.services.knowledge_graph` is the authoring
          checker
    - [x] Graph tools — `services/graph_tools.py`: `graph_lookup`,
          `graph_query_natural`, `graph_traverse`, and `TraversalPath`, which
          records every hop regardless of caller so the viewer had real replay
          data before any agent existed
    - [x] **Track 2 is embedding-free by decision.** `graph_query_natural` was
          specced (research/03 §7) as a vector search over node descriptions;
          it is authored aliases plus a stdlib fuzzy fallback instead. If both
          tracks depend on an embedding model the comparison cannot separate
          "the graph helped" from "the embeddings helped". `entry_strategy` is
          recorded per query so the report can state this from the data
    - [x] API — `/api/graph/{schema,nodes,nodes/{id},coverage,traversals,traversal/{query_id}}`
          plus `/api/corpus/*` on honest empty states. Read-only, opened
          `read_only=True`, and deliberately no "run a traversal" endpoint
    - [x] UI — `components/blueprints/`: graph browser, coverage, hop-by-hop
          replay, corpus empty state
    - [x] Seeder — `POST /api/system/seed-graph-traces` records *real* walks
          through the real tools, so the viewer is developed against the shape
          the orchestrator will write. Rows marked `vector_db_used='seed'` and
          excluded from every reported metric
    - [x] **The corpus pipeline is built (M2's ingestion half).** Upload →
          extract → chunk → embed → Chroma, as one orchestrated run with every
          stage on the record. `services/{extraction,chunking,ingestion,
          corpus_config}`, `db/corpus_store`, `api/corpus.py`, and Blueprints →
          Corpus as the operating surface
    - [x] **Track 1's tabs now mirror Track 2's: Corpus · Replay · Build.** One
          tab called *Corpus* was doing inventory, chunk settings, embedding
          model and the run, which made the name wrong — the corpus is the
          artefact and most of that screen was the machinery producing it. Split
          three ways: Corpus is the inventory (documents, and chunks as the
          retriever stores them), Build is the pipeline, Replay is the trace
    - [x] **Track 1 has retrieval replay** (`/api/corpus/retrieval/{query_id}`).
          Track 2 could always show its working hop by hop and Track 1 could show
          nothing, which was a hole in the project's own claim: a comparison
          where only one arm is auditable is not a comparison, and *grounded* is
          not assertable about an arm nobody can inspect. Shows the query, the
          passages, the cosine distance each came back at (as stored, never
          converted to a similarity — the conversion is friendlier and
          uncheckable) and the document each belongs to
    - [x] **A retrieved chunk that no longer exists is reported, not dropped.**
          `rag_logs` holds ids and the text is joined from the corpus; when the
          join misses, the answer was grounded in a passage the corpus can no
          longer produce. That is a finding an evaluation needs, not a rendering
          problem to hide
    - [x] **`rag_logs` is written at the dispatch boundary, for both tracks.**
          Nothing wrote a vector row before — only the dev graph seeder wrote
          anything at all. The two search tools stay separate implementations
          (that is what makes "which track answered this" recoverable) but are
          recorded by one writer, or the comparison measures two instrumentation
          methods as much as two retrieval strategies. No `query_id` writes
          nothing: a tool trialled in Settings is not a query
    - [x] **The corpus panel is a stepper — Import → Chunk → Embedding → Run.**
          One page holding all four was congested and gave no clue what to do
          first, which is a symptom of the real problem: the stages are
          sequential and dependent, not four independent panels. Back is always
          allowed (adjusting chunk settings against the preview is inherently
          repetitive); forward is gated, and the rail states the reason rather
          than silently disabling itself
    - [x] **The step rail is circles joined by a filling track**, not four
          buttons. Four boxes say "these are four places you can go"; they are
          not — they are one process with an order, and a connector that fills
          between 1 and 2 makes a claim four boxes cannot however they are
          styled. The fill is a `scaleX` from the left, so forward grows toward
          the next step and back drains toward the previous one — the motion
          matches the travel instead of just marking a state change. The
          travelling highlight is on the crossed segment only; a row where every
          connector shimmers reads as "loading", not "you are here". Under
          `prefers-reduced-motion` the fill still lands and only the travel goes
    - [x] **Step 3 reports the embedding model and hands off to the Forge.** It
          briefly listed every model with its own Pull buttons, which was a
          second model console inside the corpus panel — the Forge already owns
          pulling, quantization, hardware fit and the embedding pane, and two
          surfaces doing one job drift until one is subtly wrong about what is
          installed. What belongs here is the question the *pipeline* needs
          answered — can the run embed, and with what — plus the consequence
          specific to ingestion: the model is stamped onto the index it builds,
          so changing it later invalidates every vector. A button opens the
          Forge, because a sentence telling somebody where to go is a worse
          version of a control that takes them there
    - [x] **Dropped the "Shared by both tracks" footer.** It was written when
          the corpus tab was an honest empty state that needed explaining, and
          survived into a working pipeline as furniture on every step — it read
          as a placeholder notice rather than an architectural note. The point
          it makes is real and lives in MODULES.md §3.1 and the module docstring
    - [x] **Chunking is pure and therefore previewable.** `services/chunking`
          does no I/O at all, which is what lets the panel run the real chunker
          over the real document at candidate settings and write nothing. Three
          strategies — recursive (default), paragraph, fixed — with `fixed` kept
          deliberately as the naive baseline the comparison may want. Sizes are
          characters; tokens are estimated at 4 chars and labelled as estimates,
          because counting real ones needs the embedding model's tokenizer and
          would break preview before a model is pulled
    - [x] **Every vector is produced by the selected model, never by Chroma.**
          Chroma will happily embed with its own bundled MiniLM, which would put
          vectors in an index stamped `nomic-embed-text` and make every score
          meaningless with nothing on screen to say so. Ingest passes explicit
          embeddings; `search_corpus` now passes `query_embeddings` through
          `ingestion.embed_query` rather than `query_texts`, which was the same
          bug on the query side where no stamp can catch it
    - [x] **Failure is partial and recorded as such.** Batches of 16, outcome
          per chunk, so a run that dies at chunk 400 of 900 keeps the first 399
          and `Resume` picks up exactly the rest. `Clear vectors` drops the
          index and keeps the text, which is what an embedding-model change
          needs — re-parsing every PDF to reach text that never changed is work
          done twice
    - [x] **`ingest_events` is the debugging surface.** Every stage writes a
          level-tagged row, so "it produced nothing" and "it produced nothing
          *because the embedding model was never pulled*" are different answers.
          Verified against the real failure: 60 chunks written, 0 vectors, and
          the reason named in the log
    - [ ] **Ingestion must report graph gaps.** Dropping a document in gives
          Track 1 a searchable document for free while Track 2 stays blind until
          nodes are hand-authored — which quietly tilts the comparison.
          Ingestion should flag documents with no matching `SOPDocument` node as
          another Coverage row. Both pipelines now exist, so this is a join
          between them rather than a thing waiting on one of them
    - [ ] **Reconcile the placeholder SOP filenames** against the real corpus
          when it lands. The four `filename:` values are authored to shape, not
          to any file that exists; `filename` is the join into `source_file`, so
          one that matches nothing retrieves nothing, silently
    - [x] Force-directed canvas (MODULES.md §3.6) — `d3-force` from npm,
          bundled by Vite, never CDN (Rule 1). SVG not canvas at this size, and
          the simulation runs 300 ticks then **stops** rather than idling. Two
          views of the same filtered query: diagram for structure, table for
          inventory
    - [x] **Fit, zoom and pan.** The canvas hard-coded a 720x460 viewBox, but a
          force layout spreads to whatever the forces imply and has no idea a
          frame exists — measured on the real graph shape, **16 of 37 nodes fell
          outside it** and were silently clipped. The viewBox is now computed
          from the nodes' own bounding box, padded for labels and corrected to
          the drawing area's aspect ratio; wheel zooms about the cursor, the
          background pans, and Fit returns to the whole graph. Zoom is clamped
          to 0.2x-3x of the fitted width so a scroll gesture cannot end on an
          empty screen
    - [x] Stepped replay — the walk's subgraph with a hop-by-hop highlighter,
          which is §3.2's "highlighting each node and edge in sequence"
    - [x] **Hops record their real edge pairs.** The first format stored only
          the `from` and `to` node *sets*, and the sets do not imply the
          pairings — a hop spanning two Sensors and two Thresholds has four
          possible pairs and two real ones, so the diagram drew edges the graph
          does not contain. Fixed in the recorder rather than guessed at in the
          renderer
    - [x] **Track 2 has an authoring pipeline.** `services/graph_authoring` plus
          `/api/graph/authoring/*` and Blueprints → Build: add and delete nodes
          and edges, with the forms generated from the backend's own schema so a
          dropdown cannot offer an edge the validator refuses. Validate-then-
          write is the whole safety argument — the candidate graph is built in
          memory first and the file is only rewritten if that build succeeded,
          so a rejected edit leaves the YAML byte-identical
    - [x] **The authored graph moved to `config/`.** It was under `app/data/`,
          which `docker-compose` mounts **read-only** — correctly, since the app
          should not rewrite its own source. In-app authoring therefore worked
          in a bare uvicorn and 500'd in the container, which is the worse way
          round. `config/` is writable *and* git-tracked, so MODULES.md §3.4's
          "reviews in a diff" still holds. The packaged copy is the seed; the
          first edit copies it across, so a fresh checkout needs no setup
    - [x] **Refused edits are logged with their reason** (`graph_edits`). The
          schema saying no is the most informative event in an authoring session
          — `Sensor --RESOLVED_BY--> SOPDocument` is plausible English and
          meaningless here — and a history of only what worked would omit
          exactly what somebody is debugging. Deleting a node is refused while
          edges point at it, and the refusal names them
    - [x] **No inference, no suggestion, no model in the authoring path.** A
          node exists because a person wrote it, which is the provenance claim
          that makes `search_graph` SYSTEM integrity rather than CORPUS
    - [x] Retrieval track switch — Settings → Knowledge Base, committed to
          `config/rag_config.json`, read on the chat path, recorded per query in
          `rag_logs.track`. Honours §5's freeze: `frozen: true` makes the API
          refuse writes so unfreezing is a visible commit
    - [x] **Blueprints shows one retrieval track — the live one.** It reads
          `/api/rag/config` and renders only that track's tabs: Track 1 · Vector
          holds Corpus; Track 2 · Graph holds Graph, Coverage and Replay. Corpus
          is filed under Track 1 but says it is shared, because the graph track
          indexes the same chunks
    - [x] **The two-track picker is gone, and so is the track chip.** Two tracks
          offered as peer buttons asked the reader to choose between two systems
          when the choice had already been made in Settings — and only one of
          them was responsible for any answer they had seen. A picker is the
          wrong shape for a setting that lives elsewhere, so the window follows
          the setting instead. The `Track 2 · Graph ●` chip went with it: with
          one track on screen it distinguished that track from nothing, and the
          window subtitle already names what is live
    - [x] **The other track is not reachable from the window at all.** The
          fallback detour went too: no "inspect the other one" button, no Back
          control, no off-track banner, and `TrackBanner.tsx` deleted as dead
          code. The palette filters its Blueprints rows by the live track and
          the window refuses a foreign tab even when asked by name, so all three
          layers — model tools, window tabs, palette rows — answer the setting
          identically. Verified both ways
    - [x] The cost is real and deliberate: with Track 1 live there is no way to
          reach Build or Coverage, so authoring the graph means switching the
          track first. That is one setting rather than a second door, and the
          switch is a committed file recorded per query — which is what keeps
          "I was working on the graph" a recoverable fact about the run
    - [x] **Fixed: clicking Labyrinth Blueprints opened whatever tab the palette
          last jumped to.** `blueprintsTab` in `__root` is sticky state, not an
          event, and the sidebar row and the shortcut both opened the window
          without touching it — so one `Ctrl+K` jump to Coverage made Coverage
          the landing tab forever. All three entry points now go through one
          `openBlueprints(tab)` that sets it explicitly
    - [x] **Four fallbacks, one per failure, none of them a blank page**
          (MODULES.md §0 rule 4). *Track not read yet* — a skeleton tab row at
          its final height; guessing a track and correcting it a moment later
          would swap the tab row under the cursor. *Config unreadable* — names
          the error, offers Retry, keeps the last known track rather than
          blanking a view that was correct a second ago, and offers the graph
          views anyway when nothing was ever read. *Live track not ready* — it
          is still what the window shows, because readiness is reported and
          never enforced, but when the other track has data the notice says so
          and links to it. *View empty* — each view's own `Unavailable`
    - [x] Replay is the case that needed the banner: with Track 1 live nothing
          writes a traversal, so the tab would keep rendering old walks with no
          sign they were recorded under a setting that no longer holds
    - [x] `./daedalus.sh dev` now starts the chromadb container. It previously
          started neither Docker nor Chroma, and `.env`'s `CHROMA_URL` names the
          compose service (`http://chromadb:8000`), which does not resolve on
          the host — so the vector store read as unreachable rather than as not
          running. `host_chroma_url` rewrites it to the published port, the same
          cure `host_ollama_url` already applied
- [x] **A track may not retrieve through the other arm.** `PROJECT.md` §5 is a
      controlled comparison, and the registry was offering `search_graph`,
      `graph_lookup`, `graph_traverse` and `graph_coverage` whatever the selected
      track was — so a Track 1 run could produce an answer filed under
      `rag_logs.track='vector'` that a vector-only system could not have
      produced, with nothing in the logs saying so. Tools now declare a `track`
      and the gate withholds the other arm's at runtime. Verified both ways: the
      model-facing tool list flips with the setting
  - [x] It is a third axis, not a fourth permission. `_FORBIDDEN_AT_RUNTIME` is
        safety and an operator may unlock an effect with a reason; this is
        experimental validity and has **no unlock**, because "let this arm use
        the other arm's retrieval" is not a permission anybody can grant — it
        just makes the measurement mean something else. Change the track in
        Settings → Knowledge Base and the other set becomes available
  - [x] `knowledge_status` deliberately carries no track. It reports on both arms
        without retrieving through either, and it is the check that makes "I
        don't have that" a statement rather than a guess — which matters most,
        not least, on the arm that is not ready
  - [x] The `SETUP` surface is exempt, so trialling a tool in Settings → Agent
        Tools still works. Nothing an operator does there is recorded as a query,
        so there is no measurement to protect — the same reasoning that exempts
        setup from the effect gate
- [x] **The Blueprints tab table moved to its own module** (`blueprints/tabs.ts`).
      A file exporting both a component and a plain value breaks React Fast
      Refresh, and the dev server was falling back to a **full page reload** on
      every edit — losing the open window, the active tab and any half-filled
      form, which is most of what makes HMR worth having. It is the right shape
      anyway: the command palette needs the list and has no business importing
      the window to get it
- [x] **`rag_config` stopped reporting `blocked_by: "M2"`.** It said that
      whenever Track 1 was not ready, which stopped being true the moment
      ingestion was built: an empty corpus is not a missing milestone, and the
      two have completely different fixes. Naming a blocker somebody cannot act
      on while hiding the one they can is worse than saying nothing. The blocker
      is now computed from the pipeline's own state in the order the pipeline
      runs — no documents → nothing chunked → nothing embedded → a mismatched
      index — so it always names the next thing to do
- [x] **Fixed: a minimized Blueprints kept the old track.** Minimize hides with
      `display: none` rather than unmounting — deliberately, so tab, scroll and
      filter state survive — but that means the window can sit invisible across
      a track change in Settings and come back showing the other arm's tabs.
      `open` never changed, so nothing re-read the config, and closing and
      reopening was the only cure. Two signals now: `setRagTrack` dispatches
      `RAG_TRACK_CHANGED_EVENT` from the **client**, so every path that changes
      the track notifies by construction rather than by the panel remembering to;
      and `FloatingWindow` passes `minimized` to its children, so the window also
      re-reads on the restore edge — which covers causes no frontend event can
      know about, such as the `manage_settings` tool writing the config from the
      backend
- [x] **Fixed: the Forge's expanded model row popped in.** Two causes, and the
      second was the bigger one. (1) `Collapse` cascades the *direct children*
      of its own element, and `Detail` wrapped every section in a layout `<div>`
      — so the whole panel was one child, and the cascade degraded to a single
      beat. The grid moved onto the Collapse's `className` and `Detail` returns
      a fragment, so the sections are the rows. (2) Nothing animated the
      **height**: the box appeared at full size with its contents catching up,
      which on a 400px panel is most of what reads as a pop
  - [x] New `variant="flow"` on `Collapse`, beside the default domino. The
        container unfolds with `grid-template-rows: 0fr → 1fr` — which animates
        to content height without anyone having to know it, unlike `max-height`
        where guessing low clips and guessing high animates empty space — and
        the sections settle *downward* from slightly above, so the eye is
        carried top-to-bottom as the panel fills. No overshoot: the domino's
        bounce is character on a 28px row and a wobble on a 400px panel
  - [x] Applied to all three Forge row expansions (Models, Added Models,
        Embedding catalogue) so things behind the same chevron open the same
        way. **The sidebar keeps the domino** — it is a list of rows, which is
        what that cascade is for
- [x] **Fixed: three native `<select>` elements ignored the theme.** A native
      select's option list is drawn by the operating system, so on a dark theme
      it renders as a grey menu with a blue highlight and unreadable rows.
      `ui/theme-select` was written for exactly this and says so in its own
      docstring — the edge pickers, the preview document picker and the graph
      type filter simply were not using it. The last of those carried a
      `theme-select` class that **does not exist in the stylesheet**, so it was
      an unthemed control wearing a classname that looked handled
- [x] **The stepper moved to `ui/stepper`** and Track 2's Build uses it too.
      Both tracks have a *Build* tab and should not each invent their own idea
      of what a step looks like — two rails that disagreed would undo the
      comparison in the one place the arms are meant to read alike
  - [x] Graph authoring is now Nodes → Edges → Review. The dependency is real
        and it is the first thing that confuses people: **an edge cannot exist
        before its two endpoints do.** On one page the edge form sat fully
        rendered with two empty pickers and no way to tell whether that was a
        bug or the honest state of an empty graph; as a gated step the rail
        states the reason. Back is unrestricted, because authoring is iterative
  - [x] Surveyed the rest and **deliberately converted nothing else.** The
        Forge's model table is the clearest non-candidate: its estimate, verdict
        and measurement are columns of one row and `ForgeWindow` already argues
        that separating them would hide the comparison the module exists to
        make. The MCP add-server form is four fields — splitting it across three
        screens would be ceremony. A stepper earns its place when stages are
        sequential *and dependent*, not whenever there is more than one input
- [x] **The Blueprints tab row is centred.** Every tab stays a quarter wide so
      switching tracks slides the underline instead of redrawing the header at a
      new per-tab size — but left-aligned, Track 1's three tabs left a quarter of
      dead rail that read as a tab which had failed to render. The underline now
      positions against the tab group rather than the full-width row
- [x] **Assisted graph authoring — built.** `services/graph_proposals`,
      `/api/graph/proposals/*`, and Blueprints → Build → **Propose** as step 1.
      Reads the ingested corpus, extracts candidates under the graph's own fixed
      schema, canonicalises them against what exists, dry-runs them through the
      real validator, and queues the result. Nothing reaches the YAML without an
      accept, and `accept` goes through `graph_authoring` so it is validated and
      written to `graph_edits` exactly like a hand edit
  - [x] The prompt's schema block is **generated from `knowledge_graph`**, never
        hand-copied. A literal would drift the first time a node type was added,
        and the drift would be invisible — the model would simply stop proposing
        the new type and nothing would fail
  - [x] Every proposal quotes its source sentence verbatim, and the extractor is
        told to omit anything it cannot quote. That is the difference between
        reviewing a claim and trusting a model
  - [x] Invalid proposals are **queued with the schema's refusal**, not dropped.
        A proposer that hid its own bad output would look perfect and hide the
        number this feature is judged on. The flag is a propose-time snapshot —
        an edge refused for a missing endpoint becomes acceptable once that node
        is accepted — so the UI offers "Accept anyway" and re-validates for real
  - [x] **Found by testing: edges had no duplicate guard.** Nodes did, via
        `_canonical`. A duplicate *edge* is not a schema violation — the graph
        is a MultiDiGraph keyed by edge type, so re-adding one is a silent
        no-op — so it passed the dry run as valid and failed at accept time with
        "already exists", i.e. after a person had reviewed it and clicked
  - [x] Verified end to end against `qwen3:1.7b` on a reactor paragraph: 8
        duplicates suppressed, one new `Sensor` proposed with its unit extracted,
        three edges correctly refused — including
        `SOPDocument --RESOLVED_BY--> AnomalyType`, which is plausible English
        and backwards in this schema. Accept applied it and logged it; rolled back
  - [ ] Still to do: a per-document scope control, and re-validating the queue's
        `valid` flags after an accept so the snapshot refreshes without a re-run
- [x] **No default embedding model.** The config shipped naming
      `nomic-embed-text`, so every fresh install looked like a choice had been
      made — a claim about a model that may not even be pulled, and a claim about
      the one setting here that is *irreversible with respect to the work*, since
      the model is stamped onto the index it builds. `unset` is now a real state
      the whole module handles: `index_state` reports it, `resolve_for_runtime`
      refuses with the reason, the pipeline blocks on it, and the Forge renders
      it neutrally rather than as a fault
- [x] **The corpus store is browsable in the sidebar.** Found while auditing the
      docs: `corpus.db` was documented as the Vector store's relational half and
      was not in `log_browser.BROWSABLE`, so nothing could read it. The whole
      reason the manifest is SQLite rather than something inside Chroma is that
      it *can* be read — an ingest that produced nothing, a chunk that never got
      a vector, a proposal the schema refused are each answered by looking at a
      row. Five stores listed now, and nothing in the new tables holds a
      credential
- [x] **Fixed: clicking a node in the graph answered off-screen.** The detail
      rendered in the grid row *below* a 460px canvas, so the selection updated
      something nobody could see and the click read as doing nothing. Docked to
      the right of the canvas now, with a clear-selection button. Beside rather
      than overlaid — an overlay occludes the structure being read, which is the
      point of the diagram — and the canvas keeps its own `viewBox`, so
      narrowing it scales the drawing instead of re-running the layout. Below
      the container breakpoint they stack and the panel scrolls itself in
- [x] **The graph diagram fills the window.** It was a fixed 460px box, so
      maximizing added a screen of empty space under it rather than more graph.
      The canvas measures its own frame (`useElementHeight`) and takes the
      leftover height — `min-h-full` on the window body plus a `flex-1` diagram
      row, which the other tabs simply do not opt into. `vh` would be wrong
      here: the window is resizable, so the viewport's height says nothing about
      this element's
  - [x] A resize adjusts the viewBox's **aspect**, not a re-`fit()`. Refitting
        would discard whatever the reader had zoomed and panned to, and a resize
        is a request for more room rather than a request to go back to the whole
        graph — so the horizontal extent and centre hold and the new pixels buy
        more graph
- [x] Add a traversal-path column to `rag_logs` **now** — migration `005`
      adds `traversal_path` and `entry_strategy`. Landed before the orchestrator
      writes its first row, which was the whole point: a path is not derivable
      after the fact
- [x] Mark the unbuilt modules in the sidebar — Ariadne's Thread is disabled
      with a dot and a tooltip; The Forge and Labyrinth Blueprints open
- [x] **The model picker is in both composers.** It only existed in the greeting
      one, so once a chat had started there was no way to change model without
      opening a new conversation — wrong for a multi-model system, and it left
      the per-message `model_tag` column with nothing to record. Both now render
      one shared `ComposerControls`, which is what stops them drifting again.
      Note `build_context` replays history, so a model switched to mid-thread
      continues the previous model's answer rather than answering fresh
      (`BENCHMARK.md` §9.7)
- [x] **Cloud models are selectable, marked, and logged apart.** Rule 1 narrowed
      from *prevented* to *recorded*: `choose_model` honours a cloud override,
      the turn is written `source='chat_cloud'` with its `host`, the picker puts
      those rows under "Evaluation only · not Rule 1 safe", and the transcript
      badges the answer. Every Objective 3 query filters `source='chat'` and keeps
      describing the local production path unchanged (`PROJECT.md` §3 Rule 1)
- [x] **Capability badges in the model picker** — `thinking`, `tools`, `vision`
      from Ollama's `/api/show`. Model choice is not only about speed: a reasoning
      model is structurally slower to first token and answers differently
- [x] **`model_tag` never reached the browser.** The store wrote it and read it
      back, but `MessageOut` did not declare the field and FastAPI's
      `response_model` silently drops what it does not name — so the transcript
      could never say which model answered, and a cloud turn could not be told
      from a local one after the fact. Declared now
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
  - [x] **The stores take a fixed share of the sidebar column, not a capped
        one.** They used to size to their content and merely *cap* at 45%, so
        expanding a store grew the block, moved the rule between the two lists
        and shrank the chat list under the cursor. `max-h-[45%]` →
        `basis-[45%] grow-0`: the cut is where it always is, and an expanded
        store scrolls inside it
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
- [x] **Removed the orphaned stores under `backend/data/`** and widened
      `sync.sh`'s check to catch the directories too, not just the three `.db`
      files. The originals predate the host-path mapping, but `paths.py` creates
      its tree on import, so running a backend script by hand from `backend/`
      recreates it and writes measurements to a store nothing reads — which is
      exactly how one benchmark row went missing during this work. `prefs.db`
      lives in `backend/data/` legitimately and is untouched
- [x] **Host/container path mapping** — `.env` holds container paths, so `daedalus.sh dev` was pointing the dev server at `backend/data/` while Docker wrote to `data/` and `logs/`. Host-side commands now map them, so both see the same files
- [x] Unknown `/api/*` paths return 404 instead of falling through to the SPA catch-all
- [x] Unified model discovery via `/api/system/models` querying both Ollama REST API (`OLLAMA_BASE_URL`) and cloud benchmark endpoints.
- [x] **`/api/system/models` routed through `ollama_client`.** It previously called
      `/api/tags` itself and labelled *every* row `type: 'local'`, so Ollama's
      cloud tags were offered in the chat picker as if they could answer. It also
      bypassed the base-URL fallback, so in dev mode it paid a full DNS timeout
      and returned nothing. Cloud rows now return `type: 'cloud'` with a `note`,
      and the picker shows them disabled under "Benchmark only · Rule 1"
- [x] **Forge → Added Models → Cloud is an inventory, not a form.** It opened
      straight onto the add-API-provider panel, so Ollama's cloud tags were
      invisible everywhere in the model manager. It now lists them with a
      benchmark action, lists configured endpoints with their test status, and
      reaches the add form only when asked
- [x] The **Installed** tab in Forge → Models filtered `row.source === 'installed'`
      — but `source` is *provenance*, not state, so a shortlisted model kept
      `source='shortlist'` once pulled and the tab was permanently empty. Filters
      the `installed` boolean now
- [x] Dynamic model integration — Chat interface selector now adaptively loads models on-hand instead of hardcoded placeholders.

---

## Known issues

- [ ] Chat responses are synchronous — `POST /api/chat` answers in one shot with
      no streaming. Fine at 300–400ms to first token on a 3B model, and not fine
      on anything larger
- [ ] The chat path has no retrieval or tool-calling yet: it replays conversation
      history and answers. `evidence` is threaded through `inference.answer()`
      unused, so the prompt is already in its final shape for M5/M6
- [ ] 24 oxlint warnings across `src/`, zero errors: 16 `set-state-in-effect`
      (the legitimate kind — an effect synchronising with the backend on mount)
      and 8 `react(refs)`, nine of the latter in `GraphCanvas`, which drives a
      D3 simulation and holds refs on purpose. Counted over the whole tree
      rather than the handful of files a previous entry had checked
- [ ] Anyone who ran `daedalus.sh dev` before the path fix has orphaned databases under `backend/data/` — `sync.sh` reports them; they are not deleted for you
- [ ] No automated tests on either side. The chat store, migration runner and session API were verified by direct calls, but nothing is in CI — the migration runner especially wants a test suite, since it is the piece that can quietly break every other store
- [ ] `daedalus.sh` assumes the Docker daemon is running — it reports the failure but can't start it
- [ ] Editing `config/searxng/settings.yml` only changes what a **fresh**
      SearXNG volume gets. An instance that has already booted keeps its own
      copy, on purpose — so applying a template change means
      `docker volume rm daedalus_searxng-data` and letting it re-seed
- [ ] The SearXNG image logs three engine init failures on every boot (`ahmia`,
      `torch`, `radio browser`). Upstream noise, unrelated to the engines
      Daedalus enables, and harmless — but it makes `docker logs` look worse
      than the container is
- [ ] **Embedded Chroma does not work on a default install.**
      `requirements.txt` ships `chromadb-client`, which is HTTP-only, so an
      unset `CHROMA_URL` is not a fallback to embedded mode — it is no vector
      store at all, and `index_state` reads `unknown`. Either run
      `./daedalus.sh dev`, which starts the container, or install full `chromadb`
- [ ] **`config/embedding_config.json` carries a `verified` record that cannot
      be real:** `nomic-embed-text` at 512 dimensions with `elapsed_ms: 0`, and
      `indexed_at` set while `indexed_with` is null. Nomic is 768, no embedding
      model is installed, and `record_index()` cannot produce that pair — it
      looks seeded. Since a verified width outranks a declared one it now shows
      as "512d (verified)" in Settings → Knowledge Base. Clear the block, or
      re-verify once an embedder is pulled
- [ ] `POST /api/system/seed-demo` is a development convenience with no auth — remove or gate it before any shared deployment
- [ ] Search results are read by a person, not ingested. There is no "save this
      result to the corpus" path, so sourcing is still copy-a-URL-and-download
      by hand. Worth building with M2's extractor rather than before it, since
      the thing it would write into does not exist yet
- [ ] A cloud search provider's key is stored in plain text in `prefs.db`,
      exactly as the benchmark API keys are, and with the same caveat: fine for
      a single-user local deployment on a git-ignored file, not a secret store
- [x] **`./daedalus.sh dev` runs in containers**, with the source bind-mounted
      and uvicorn/Vite reloading in place. `--host` keeps the old two-process
      path for attaching a debugger. The reason is not tidiness: every address in
      `.env` is written from the container's point of view, so the host path
      needs three functions in `common.sh` that rewrite them back to published
      ports — a translation layer between two versions of reality. In the
      container they are just the addresses, and `/data`, `/logs`, `/config`
      mean what they mean in the image that ships
      - [x] `ports: !override` — compose merges `ports` by concatenation, so
            without it the dev service publishes DAEDALUS_PORT *and*
            BACKEND_PORT and collides with itself at 8000. Found by it failing
      - [x] `image: daedalus:dev`, so a dev build never overwrites the shipping
            tag; an anonymous volume over `/app/node_modules`, because
            rollup/esbuild/oxide binaries are per-platform; `--remove-orphans`
            on `stop`, so one stop covers both stacks
      - [x] Verified: container healthy, `/app/data/prefs.db` (container paths,
            not remapped host ones), `chromadb:8000` and `searxng:8080` resolve
            unmapped, and a `touch` on a backend file restarts uvicorn in place
      - [x] **Two bugs the end-to-end check caught, both mine:**
            `docker-compose.yml` did not name a build target, and a Dockerfile's
            default target is its *last* stage — so adding `dev` at the bottom
            made `./daedalus.sh start` build the development image, which points
            `DAEDALUS_STATIC_DIR` away from the bundle. The API worked and the
            dashboard 404'd. `target: runtime` is now explicit
      - [x] `load_env` claimed "anything already exported wins" and did the
            opposite: `set -a; . ./.env` is a plain assignment per line, which
            beats the environment. `DAEDALUS_PORT=9000 ./daedalus.sh start`
            silently published 8000. It now saves the pre-set values and
            restores them over the file's
- [x] Settings → Agent Tools rewritten compact: 491 → 360 lines, three
      explanatory cards collapsed into one line of subtitle, the four
      capabilities reduced to toggle chips with the consequence on hover, and
      the tool list to one row each. The removed copy was written when the
      effects shipped closed and opening one was an event; with open as the
      default the standing warning fired permanently, and a warning that is
      always on is decoration
- [x] **Email and Reminders removed.** Both were placeholders for features
      Daedalus has no use for — a reactor monitoring console does not send mail,
      and "reminders" was never more than a word borrowed from the assistant
      this settings shell was ported from. A placeholder for something nobody
      intends to build is a promise in the navigation
      - [x] That emptied the Communications group, and Integrations was never a
            communications feature anyway: an MCP server is the external half of
            the tool layer. It moved next to Agent Tools, and the group went with
            the two panels. 13 panels, five groups, none orphaned
- [x] **Search readiness meant "configured", not "working".** `SEARXNG_URL` is
      in the container's environment whether or not the search container is
      running, so the panel reported the provider ready while every query failed
      with a DNS error. Readiness is now a 1.5s probe of the configured address,
      and an unreachable instance names the command that fixes it
- [x] **`dev` and `start` now start SearXNG when it is the selected provider.**
      Called after `wait_for_api`, since the selection lives in `prefs.db`.
      Choosing it in Settings is enough; nothing starts for a provider nobody
      picked. The earlier "deliberately no `ensure_searxng`" reasoning was about
      starting one *quietly*, which this is not
- [x] **Settings → System built** — process log, backup, Danger Zone, following
      the Odysseus panel of the same name
      - [x] The backend had no file logging at all, so there was nothing to tail.
            A rotating handler on the **root** logger (5 MB × 3) now mirrors
            stdout to `daedalus.log`; uvicorn's records and library warnings are
            exactly what a log viewer is opened for. Format fixed and parseable,
            unparseable lines kept — a traceback is several lines matching no
            format and is the most useful thing in the file
      - [x] The tail seeks from the end, and filtering is server-side: Odysseus
            sends the whole tail and filters in the browser, which is fine for a
            click and wasteful for a three-second poll
      - [x] **Backups carry no credentials.** Odysseus exports everything; a
            backup gets emailed and left in a downloads folder, so keys are
            recorded as set/unset and re-entered after a restore. Import is
            additive, and transcripts are deliberately not restored — new session
            ids would leave audit rows pointing at ids that no longer exist
      - [x] Nine wipe categories plus *everything*. The **sensor database is not
            one** and cannot be (Rule 2); the audit log is, with heavier copy,
            because it is the evidence §9.2's figures come from
- [x] **Danger Zone confirmation is a real dialog.** Buttons say *Delete*, not a
      bin glyph, and confirmation is a themed `ui/confirm-dialog.tsx` instead of
      `window.confirm` — which ignores the theme, cannot describe what is about
      to happen, and cannot ask for anything to be typed. The audit log and
      *everything* require typing `DELETE`: two clicks can be muscle memory
      - [ ] The Forge's two `window.confirm` calls (delete a pulled model) could
            adopt the same dialog. Left alone for now — they were not in scope
- [x] **SearXNG can be started and stopped from Settings → Search**, when a
      Docker socket is mounted into the backend. **Off by default**, and that is
      a position: a process that can reach the socket can do anything Docker can
      on the host, and `bash`/`python` run in the same container with
      `execute_code` unlocked. Either leave it off and run one command, or turn
      it on and lock `execute_code`
      - [x] Scoped to an allowlist of container names — verified that
            `chromadb`, `daedalus` and the neighbouring project's
            `odysseus-searxng-1` are all refused, and that stopping Daedalus'
            SearXNG left Odysseus' running
      - [x] Stop, never remove: re-creating a container needs the image,
            entrypoint, volume and network, which `docker-compose.yml` already
            describes
      - [x] Two things found by it failing: `available()` now means *usable*
            rather than *configured* (the socket is root:docker 660 and the image
            is uid 1000, so it can be present and unopenable), and
            `group_add: ${DOCKER_GID:-999}` is what makes it readable. An EACCES
            now names the variable to set
- [x] Both placeholders removed: **Account** and **Users**, and the sidebar's
      dead `Sign out` item with them. There is one operator, they are the admin,
      and there is nothing to sign out of — the same reasoning that opened the
      tool policy by default. Settings has no unimplemented panels left; the
      `account` group went with its only member
- [x] **Shortcuts** built, ported from Odysseus' keybind layer: 11 actions, a
      typed map so an action without a handler fails to compile, preview-then-
      commit rebinding, conflicts shown with the rule that resolves them, and the
      AltGr guard that stops an `@` on a German layout deleting a conversation.
      Persisted to the `keybinds` preference, server-side like everything else
  - [x] **`Ctrl+K` is a command palette, not the chat filter.** The filter was
        good at narrowing a list you are already reading and bad at reach —
        every other destination in the console had its own separate path. The
        palette covers chats, all eleven settings panels, the four windows,
        Blueprints' individual tabs, every store table with its row count, and
        the three toggle actions. Matching is `settingsRegistry`'s rule widened
        to one haystack per row — every term must match, label beats keyword,
        deliberately not fuzzy. The `search_chats` **id is unchanged**: it is
        the key the binding is stored under, so renaming it would discard a
        rebound chord. The inline filter keeps the magnifier
  - [x] It also fixed a dead chord: the filter lives inside the block gated on
        `show('sidebar-chats')`, so with the chat list switched off in
        Appearance, `Ctrl+K` set state and rendered nothing at all. An overlay
        owned by the root has no such dependency
  - [x] Palette rows call the callbacks that already existed — the sidebar row,
        the account menu, the shortcut — so it is a second door onto the same
        handlers and never a second implementation. Chats come from
        `SessionsContext` and tables from `/api/logs/catalogue`, read on open
        rather than held, so no row can quote a count it has not checked
  - [x] Keycaps sit flush at the right edge of the row. The per-row reset button
        is hidden with `opacity-0` rather than unmounted, so that it does not
        shift the keycaps sideways the moment a binding becomes custom — but at
        the end of the row that reserved space read as the chords stopping short
        of the edge. Reset moved to the *left* of the chord, where hidden space
        is invisible
- [x] **Appearance** built, ported from the same project's visibility column:
      nine switches over the app's own furniture, grouped by region with a
      per-section reset. Chrome only — nothing switchable can hide an answer, a
      citation, a warning or a refusal. Colours and fonts stay in the Theme
      window rather than being copied into a second screen that can disagree
- [x] **GPU passthrough** — `docker-compose.gpu.yml`, layered on automatically
      when the host has an NVIDIA GPU (`--gpu` / `--no-gpu` to force it either
      way, and a dropped overlay rather than a failure when Docker declines).
      Until now the container saw no driver, so Settings → Hardware read as
      broken detection and the Forge sized models against zero VRAM. The panel
      also says which machine it is describing now: `· container`, and a GPU
      section that names the flag instead of reporting none
- [x] **Per-tool switch** for the agent tool layer — a second axis beside the
      four capability locks, stored the same way round (`tool_disabled`, 008).
      A switched-off tool leaves `/api/tools/schemas` and is refused at dispatch.
      Every parameter now declares a working `example`, filled in on expand for
      read-only tools and behind a button for the ones that write or execute
- [ ] MCP `resources` and `prompts` are not implemented — only `tools`. Nothing
      in Daedalus has anywhere to put them yet, and a half-wired capability is
      worse than an absent one
- [ ] `bash` and `python` are contained, not sandboxed. On a machine that
      matters, unlock `execute_code` only with Daedalus running in its container,
      where the process is confined by a kernel rather than by a regular
      expression
- [ ] Unlocking any extended effect invalidates a groundedness measurement taken
      while it was open. There is no automatic guard for this — the panel warns,
      and `tool_policy.unlocked_at` is what lets a reviewer check afterwards
- [ ] `render_for_prompt()` has no consumer yet — M5's prompt builder is what
      will call it. Until then the integrity fence is tested but not in the
      path, which is the right order (the marking has to exist before anything
      can honour it) but is worth not forgetting
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
- [ ] **A cloud `tokens_per_sec` is not quotable.** Ollama's cloud returns no
      engine counters, so the wall-clock fallback divides by a window of a few
      hundred ms and reported `gpt-oss:120b` at 836 tok/s. The UI marks it `~`
      with `rate_source: wall_clock`; the report must not cite it. TTFT and
      end-to-end for cloud rows are measured directly and are sound
      (`BENCHMARK.md` §7)
- [ ] Benchmark API keys are stored in plain text in `prefs.db`. Acceptable for a single-user local deployment on a git-ignored file, and the API never returns them — but it is not a secret store, and the file should not be copied around

---

## Deferred — Phase 2

- [ ] PyQt5 embedded tab (Layer 9A)
- [ ] Multi-device `device_profiles` + dynamically generated per-device tools
- [ ] Kùzu graph backend comparison
- [ ] LAN / multi-lab deployment
- [ ] Vector-DB bake-off: sqlite-vec · libSQL · Turso · FAISS · LanceDB
