# Daedalus backend

FastAPI service for the Daedalus UI. Exposes the user-preference store that
replaces browser localStorage, and the chat session store that gives the
assistant memory within and across conversations. The Layer 7 answering
endpoint and tool routers mount into the same app as they land.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Run it from this `backend/` directory. The Vite dev server proxies `/api` to
`http://localhost:8000`, so the frontend needs no extra configuration.

## Layout

```
app/
  api/        HTTP only — routing, status codes, validation errors
  services/   decisions: session policy, context-window assembly
  models/     Pydantic wire contracts
  db/         persistence
    sqlite_util.py   connections, pragmas, transactions, retry, backup
    migrations.py    the versioned-schema runner
    migrate.py       its CLI
    migrations/      the .sql files, one directory per store
```

The orchestrator calls `services/` directly. It never loops back through HTTP
to reach conversation state — that would make an internal operation depend on
the web layer being up.

## Storage

Five physically separate databases. The separation is the safety argument, not
tidiness — see `app/db/paths.py` and `docs/PROJECT.md` §6.3.

| Store | File | Access |
| --- | --- | --- |
| Sensor | `data/sqlite/sensor_readings.db` | **read-only** (`file:…?mode=ro`) |
| Audit | `data/logs/ai_logs.db` | read/write — its own logs |
| Chat | `data/sqlite/chat.db` | read/write — transcripts |
| Vector | `data/chroma` or the Chroma service | read/write |
| Prefs | `data/prefs.db` | read/write |

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

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness; also lets the UI tell "backend down" from "nothing saved yet" |
| `GET` | `/api/prefs` | Every preference in one round trip (used on boot) |
| `GET` | `/api/prefs/{key}` | Read one |
| `PUT` | `/api/prefs/{key}` | Write one, body `{"value": ...}` |
| `DELETE` | `/api/prefs/{key}` | Clear one |
| `GET` | `/api/prefs/theme.css` | Saved palette as a render-blocking stylesheet |
| `POST` | `/api/sessions` | Open a chat. Body optional; `{}` is the normal call |
| `GET` | `/api/sessions` | Sidebar list, most recently updated first |
| `GET` | `/api/sessions/{id}` | One session, including its rolling summary |
| `PATCH` | `/api/sessions/{id}` | Rename and/or archive |
| `DELETE` | `/api/sessions/{id}` | Delete a chat and its messages. Audit rows survive |
| `GET` | `/api/sessions/{id}/messages` | Full transcript, oldest first |
| `POST` | `/api/sessions/{id}/messages` | Append a **user** message |
| `GET` | `/api/logs/catalogue` | Browsable tables with live row counts |
| `GET` | `/api/logs/{store}/{table}` | A page of raw rows — read-only, allowlisted |
| `GET` | `/api/providers/catalogue` | Cloud providers offered in the UI |
| `GET` | `/api/providers` | Configured benchmark endpoints (keys masked) |
| `POST` | `/api/providers` | Add one |
| `PATCH` | `/api/providers/{id}` | Rename, re-key, enable/disable |
| `POST` | `/api/providers/{id}/test` | Connection test against `{base_url}/models` |
| `DELETE` | `/api/providers/{id}` | Remove one |
| `GET` | `/api/system/databases` | Health, size, schema version and metrics for all five stores |
| `POST` | `/api/system/seed-demo` | Generate demo telemetry. **Dev only, unauthenticated** |

Writable preference keys: `theme`, `custom-themes`, `ui-scale`, `settings-ui`.

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

`/api/logs` serves an allowlist (`chat`, `audit`), opens every connection
`mode=ro`, and caps a page at 1000 rows. `prefs` is excluded because it holds
arbitrary UI values, `model_endpoints` because it holds credentials, and
`sqlite_master` because it is not on the list at all. Unknown names 404 rather
than 403 — whether some other table exists is not something this should
confirm.

Interactive docs while running: <http://localhost:8000/docs>
