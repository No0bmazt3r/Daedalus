# Daedalus backend

FastAPI service behind the Daedalus dashboard. At its centre is `POST
/api/chat` — the Layer 7 orchestrator that answers from sensor tools and the
selected retrieval track, checks the answer against its evidence, and logs
every step. Around it: the chat session store (memory within and across
conversations), ingestion and graph authoring for the two tracks, The Forge's
hardware and model services, Ariadne's Thread, the evaluation harness, and the
preference store that replaces browser localStorage.

## Run

From the repository root:

```bash
./daedalus.sh setup    # creates backend/.venv and installs requirements.txt
./daedalus.sh dev      # uvicorn --reload on :8000, Vite on :5173
```

Prefer the script, or `host_uvicorn` from `scripts/common.sh`, over a bare
`uvicorn` in this directory. The script sets `DAEDALUS_DATA_DIR` and
`DAEDALUS_LOG_DIR` to the repository's `data/` and `logs/`; a bare run falls
back to `backend/data/…` and quietly writes to stores nothing else reads.
`sync.sh` reports such orphans. The Vite dev server proxies `/api` to
`http://localhost:8000`, so the frontend needs no extra configuration.

## Layout

```
app/
  main.py     the app, its routers, start-up migrations, the catch-all error handler
  cli_eval.py the evaluation harness (python -m app.cli_eval)
  api/        HTTP only — routing, status codes, validation errors
  services/   the logic
    query_pipeline/   §7.1 steps 1–4: normalise, rewrite, classify, guard
    orchestration/    §7.1 steps 5–8, 10: plan, execute, evidence, prompt, validate
    agent_tools/      Layer 8: every tool, and the gates it runs behind
    inference.py      step 9 (the model call) and 11 (logging), tying it together
    thread/           Ariadne's Thread: listing, trace, groundedness, retrieval
    ingestion.py      Track 1's pipeline (extraction.py, chunking.py, embedding_models.py)
    knowledge_graph.py, graph_*.py   Track 2: the graph, its walk and agent, authoring, proposals
    hardware.py, model_fit.py, benchmark.py, forge.py   The Forge
    evaluation.py     the harness behind cli_eval.py
  models/     Pydantic wire contracts
  data/       shipped catalogues (models, embedders) and the graph seed
  db/         persistence
    sqlite_util.py   connections, pragmas, transactions, retry, backup
    migrations.py    the versioned-schema runner
    migrate.py       its CLI
    migrations/      the .sql files, one directory per store
```

## Tests

```bash
python -m unittest discover -s tests -t .
```

243 tests, grouped by area — `chat/`, `tools/`, `retrieval/`, `models/`,
`evaluation/`, `thread/`, plus `test_error_reporting.py` — with an index of
every file in `tests/README.md`. Keep `-t .`: the test packages import each
other relatively, and without it ten of them fail to import.

```bash
python -m unittest discover -s tests/thread -t .   # one area
```

Stdlib `unittest`, no extra dependency. `tests/__init__.py` points every store
and the config directory at a throwaway directory before anything is imported,
so a run never touches `data/` or `config/`; the chat-path tests fake Ollama.

The orchestrator calls `services/` directly. It never loops back through HTTP
to reach conversation state — that would make an internal operation depend on
the web layer being up.

## Storage

Five physically separate databases. The separation is the safety argument, not
tidiness — see `app/db/paths.py` and `docs/PROJECT.md` §6.3.

| Store | File | Access |
| --- | --- | --- |
| Sensor | `data/sqlite/sensor_readings.db` | **read-only** (`file:…?mode=ro`) |
| Audit | `logs/ai_logs.db` | read/write — its own logs |
| Chat | `data/sqlite/chat.db` | read/write — transcripts |
| Vector | `data/chroma` (embedded) + `data/sqlite/corpus.db` | read/write |
| Prefs | `backend/data/prefs.db` | read/write |

Paths are relative to the repository root, as `daedalus.sh` sets them.

**Chat and audit are separate on purpose**, though both hold conversation
text. A user renames, archives and deletes their own chats; audit rows are
append-only evidence that a response was grounded, and the evaluation chapter
rests on them. Two files make *"deleting a chat cannot delete the evidence"* a
property of the filesystem rather than a promise about our DELETE statements.
`query_id` still links the two — `ATTACH` to join them.

> **Keep the data directory on a native filesystem.** All five use WAL, which
> coordinates through an mmapped `-shm` file. Network mounts and Windows-hosted
> paths under WSL (`/mnt/c/...`) do not reliably provide that, and the failure
> mode is silent corruption. Under WSL, keep `DAEDALUS_DATA_DIR` under `/home`.

## Migrations

Schema changes are numbered SQL files applied once, in order, inside a
transaction, with the fact recorded in the database itself.

```
app/db/migrations/<store>/001_initial_schema.sql
                         /002_add_pinned_flag.sql
```

The app migrates on startup, so normally there is nothing to run. The CLI is
for applying a change without restarting, for inspection, and for CI:

```bash
./daedalus.sh migrate             # or: python -m app.db.migrate up
./daedalus.sh migrate status      # what's applied, what's pending
./daedalus.sh migrate check       # integrity-check every database
./daedalus.sh migrate backup      # consistent snapshot (VACUUM INTO, not cp)
./daedalus.sh migrate new chat add_pinned_flag
```

`status` exits `0` up to date, `2` pending, `1` broken — so CI can tell "needs
migrating" from "is wrong".

### The rules

1. **Append-only.** Never edit a migration that has run anywhere; write a new
   one. The runner stores a checksum and refuses to proceed if an applied file
   changed, because at that point the code's idea of the schema and the
   database's real shape have diverged silently. `migrate repair <store>`
   exists for a knowingly cosmetic edit and asserts the SQL is unchanged in
   meaning.
2. **Numbers never fill gaps.** Adding `003` after `004` is applied is
   rejected — anyone who already ran `004` would never get `003`.
3. **Each file is one transaction.** A failure rolls its file back entirely;
   earlier files stay applied. A database is never left half-migrated.
4. **A migration failure at startup is fatal.** Serving requests against a
   database whose shape the code disagrees with corrupts data in ways found
   much later. Refusing to boot is the cheaper failure.

`sensor` is deliberately not managed here: the SCADA ingestion subsystem owns
that schema, and migrating a database we do not own would breach Rule 2 as
surely as an INSERT would.

## Endpoints

About a hundred routes under `/api`, listed with their purpose in
[`docs/FEATURES.md`](../docs/FEATURES.md) §2, and live at
<http://localhost:8000/docs> while the app runs. Three of them carry a rule
worth knowing before you touch them:

### Only user messages are writable over HTTP

`POST /api/sessions/{id}/messages` takes no `role` field, and that is load
bearing. History is replayed into the model's context on the next turn, so a
client able to post an *assistant* message could plant a fabricated sensor
reading where the model reads it as its own previous answer, and narrate it
back as fact. Assistant turns are written by the orchestrator through
`chat_service.add_assistant_message()` once it has actually produced them.

This is also why the transcript lives on the server rather than being posted
back by the browser each turn: client-held history is a client-controlled
input to the prompt.

### Cloud endpoints are benchmark-only, and the schema says so

`/api/providers` configures cloud models for the **offline evaluation
baseline** — Rule 1 keeps them out of the live query path. That is not a
convention this router happens to follow; `model_endpoints.purpose` carries
`CHECK (purpose = 'benchmark')`, so a runtime-purposed row cannot be written
even by a future handler that tried. Nothing in the chat path imports
`services/model_endpoints.py`.

API keys are write-only over HTTP. They go in through `POST`/`PATCH` and come
back only as a masked hint; `EndpointOut` has no `api_key` field, and the raw
log browser does not list that table.

### The raw log browser cannot reach everything

`/api/logs` serves an allowlist (`chat`, `audit`, `sensor`, `corpus`, and the
Chroma collections), opens every connection `mode=ro`, and caps a page at 1000
rows. `prefs` is excluded because it holds
arbitrary UI values, `model_endpoints` because it holds credentials, and
`sqlite_master` because it is not on the list at all. Unknown names 404 rather
than 403 — whether some other table exists is not something this should
confirm.

An unexpected exception anywhere is answered as a 500 carrying its real reason
and an 8-hex `error_id`, logged with the traceback under the same id
(`main.py`); the dashboard shows the id next to the failed action.
