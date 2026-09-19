# Scripts Reference

Every command Daedalus ships, what it does, and when to reach for it.

Three entry points at the repo root, sharing one helper library:

```
daedalus.sh    run it            setup · start · dev · stop · logs · rebuild · status · migrate
               flags             --with-ollama · --with-search · --host (dev only)
sync.sh        fix it            after a git pull — safe, re-runnable, destroys nothing
reset.sh       start over        wipe and rebuild the databases — destructive
scripts/
  common.sh    shared helpers    sourced by all three; never run directly
```

**Which one do I want?**

| Situation | Command |
|---|---|
| First time on this machine | `./daedalus.sh setup` |
| Just pulled / switched branch | `./sync.sh` |
| Want to see what a pull broke, without changing anything | `./sync.sh --check` |
| Day-to-day development | `./daedalus.sh dev` |
| Same, but you need a debugger attached | `./daedalus.sh dev --host` |
| Sourcing documents for the corpus | `./daedalus.sh dev --with-search` |
| Running it like production | `./daedalus.sh start` |
| Added a migration | `./daedalus.sh migrate` |
| Database is a mess | `./reset.sh` |
| Nothing works and you want a clean slate | `./daedalus.sh setup` then `./reset.sh` |

---

## `daedalus.sh`

The entry point. Every command loads `.env`, and anything already exported
wins — so `DAEDALUS_PORT=9000 ./daedalus.sh start` publishes on 9000.

> That override is newer than the sentence describing it. `load_env` used to run
> `set -a; . ./.env`, and a plain assignment in a sourced file beats the
> environment, so the variable you set on the command line was silently replaced
> by the file's. It now records the pre-set values and restores them afterwards.

### `setup`

One-time preparation of a fresh clone. Idempotent — safe to re-run.

1. **Verifies prerequisites** — `docker`, `node`, `python3`, `pnpm`. Enables
   pnpm via `corepack` if it is missing but corepack exists. Stops with a list
   if anything is absent, rather than failing halfway through.
2. **Creates `.env`** from `.env.example`, or tops up an existing one with any
   keys it is missing.
3. **Installs frontend dependencies** — `pnpm install`.
4. **Creates `backend/.venv`** and installs `requirements.txt`, then writes
   `.venv/.requirements-stamp` so `sync.sh` can later tell whether the
   installed packages have drifted.
5. **Creates runtime directories** — `data/sqlite`, `data/documents`, `logs`,
   `backend/data`. Made on the host so Docker does not create them as
   root-owned bind-mount sources.
6. **Applies migrations**, so a fresh clone has its schema before first run.
7. **Checks for Ollama** — a warning, never fatal. The dashboard works without
   it; only model inference needs it. If Ollama is installed but not running it
   tries to start it (systemd, or `brew services` / the app on macOS); if it is
   not installed at all, it offers to install it, but only on an interactive
   terminal. Neither path ever blocks a non-interactive run.

### `start` (alias `up`)

Builds if needed and starts the container stack, then polls `/api/health` for
up to 60 seconds. On success it prints the dashboard and API-docs URLs; on
failure it dumps the last 40 lines of container logs and exits non-zero, so a
broken start is diagnosable without a second command.

Extra arguments pass through to `docker compose up`, which is how `rebuild`
reuses it.

### `dev`

Hot-reload development **in containers**. Layers `docker-compose.dev.yml` over
the base file and starts three services: `daedalus` at its `dev` stage with
`backend/app` bind-mounted read-only and `uvicorn --reload` watching it on
`BACKEND_PORT` (8000), `chromadb`, and `frontend` — a `node:24-slim` container
running Vite on `FRONTEND_PORT` (5173), proxying `/api` across the compose
network.

Vite runs in the foreground, so Ctrl-C ends the session as it always has. The
backend deliberately keeps running: it is a container now, `stop` owns its
lifetime, and killing it on every UI restart would be a rebuild you did not ask
for.

**Why containers.** Every address in `.env` is written from the container's
point of view — `http://chromadb:8000`, `http://searxng:8080`,
`http://host.docker.internal:11434` — and none of them resolve on the host. The
host path therefore carries `host_ollama_url`, `host_chroma_url` and
`host_searxng_url`, three helpers whose entire job is rewriting those back to
published ports. That machinery is correct, and it is a translation layer
between two versions of reality. In the container they are simply the addresses,
and `/data`, `/logs` and `/config` mean what they mean in the image that ships.

It also puts the agent tool layer's `bash` and `python` behind a kernel boundary
rather than a pattern denylist, which is what `agent_tools/extended` recommends
for a machine that matters.

Three implementation details that are easy to get wrong:

| | Why |
|---|---|
| `ports: !override` | Compose merges `ports` by concatenation. Without the tag the dev service publishes `DAEDALUS_PORT` *and* `BACKEND_PORT` and fails on whichever is taken — which, when both are 8000, is itself |
| `image: daedalus:dev` | A dev build must not overwrite the `daedalus:latest` tag `start` serves |
| An anonymous volume over `/app/node_modules` | Rollup, esbuild and Tailwind's oxide binary are compiled per platform; a Linux container loading host-built binaries fails in a way that reads as a Vite bug |

### `dev --host`

The older path, kept rather than deprecated: two processes on your machine,
`uvicorn --reload` and Vite, with the URL rewriting described above. A debugger
attaches to a local process in one step, and a container that will not start is
not a reason to be unable to work.

Refuses to start if `backend/.venv` or `frontend/node_modules` is missing, and
runs migrations first so a schema failure is reported before two dev servers
start writing to the terminal. Ctrl-C stops both — the backend is killed by an
`EXIT INT TERM` trap, so it cannot be orphaned.

**It also starts the `chromadb` container.** ChromaDB is a server the app talks
to rather than part of the app, and there is no host equivalent short of
installing the full `chromadb` package — `requirements.txt` ships
`chromadb-client`, which is HTTP-only, so an unset `CHROMA_URL` is not a working
fallback to embedded mode but no vector store at all.

Not fatal when it cannot start: Track 2 (GraphRAG), the chat path, the Forge and
every SQLite store work without a vector store, and refusing to run the whole
stack because the RAG half is unavailable would be the wrong trade. It says so
and carries on.

> **Host paths.** This is where the container/host mapping matters — see
> [Host and container paths](#host-and-container-paths) below.

### `stop` (alias `down`) · `logs` · `rebuild`

- `stop` — `docker compose down`.
- `logs` — `docker compose logs -f`.
- `rebuild` — forces a clean image rebuild, then starts. This is what picks up
  pulled code in the container: the image bakes in the built frontend and the
  backend source, so a running stack serves the code it was built with until
  it is rebuilt.

### `status`

Container status, then the health of all five stores, read from
`/api/system/databases`. Fetches first and parses second, deliberately: piping
`curl` straight into a parser hides which half failed, and under `pipefail` a
mere parse error reports as an unreachable API.

If the API is not up it says so and exits 0 — "not running" is an answer, not
an error.

### `migrate [subcommand]`

Passes everything through to the migration CLI (below). With no subcommand it
runs `up`. `./daedalus.sh migrate --help` reaches the CLI's own help.

### Flags

| Flag | Applies to | Effect |
|---|---|---|
| `--with-ollama` | `start`, `stop`, `logs`, `rebuild` | Run Ollama as a container instead of using the host |
| `-h`, `--help` | any | Usage |

`migrate` is exempt from flag parsing — its arguments belong to the Python CLI.

---

## `sync.sh`

Bring a checkout back to a working state after a `git pull`, a branch switch,
or a merge. **Everything is safe and re-runnable; nothing is destroyed.**

```bash
./sync.sh              # do it all
./sync.sh --check      # report what WOULD change; touch nothing
./sync.sh --upgrade    # reinstall dependencies even if the lockfiles look current
./sync.sh --help
```

It runs eight checks in order:

| # | Section | What it catches |
|---|---|---|
| 1 | **Prerequisites** | Missing `python3` (fatal), `pnpm` (skips frontend), Docker (skips container checks) |
| 2 | **Configuration** | A teammate added a key to `.env.example`; your git-ignored `.env` never got it |
| 3 | **Backend dependencies** | `requirements.txt` changed since you last installed |
| 4 | **Frontend dependencies** | `pnpm-lock.yaml` is newer than `node_modules` |
| 5 | **Database schema** | A pulled migration has not been applied |
| 6 | **Database integrity** | `PRAGMA quick_check` on every store |
| 7 | **Orphaned databases** | Stale stores and directories under `backend/data/`, whether from before the host-path fix or recreated since |
| 8 | **Containers** | The built image is older than your source |

**Section 7 catches a trap that is still live.** The original stale copies came
from before `scripts/common.sh` mapped host paths, and those are a one-off. But
`paths.py` *creates* its directories on import, so running any backend script by
hand from `backend/` — without the env vars `host_py` sets — recreates the same
tree and writes to it. A measurement can land in a store nothing reads, and the
only sign is this section. Use `host_py` (see below) rather than calling
`.venv/bin/python` directly.

**Section 2 is the one that earns its keep.** `.env` is git-ignored, so a pull
never updates it. When someone adds a setting, your app silently falls back to
a config default and misbehaves in a way that looks nothing like a missing
variable. Missing keys are appended with `.env.example`'s values; **existing
values are never touched**, and you are told to check the new ones suit your
machine.

**Section 5 is the one that matters most after a pull.** A teammate's
migration arrives as a file, and until it runs, the code and the database
disagree about the shape of the data.

**Section 8** compares source mtimes under `backend/app`, `frontend/src` and
the dependency manifests against the *later* of the image's creation date and
`.daedalus-build-stamp`. The stamp is what makes it correct: Docker keys its
COPY layers on file **content**, so rebuilding after a whitespace-only edit is
a full cache hit that returns the existing image with its original date — an
mtime comparison alone would then say "stale" forever. `daedalus.sh start` and
`rebuild` touch the stamp on success. A check that cannot tell (no image, no
Docker) stays quiet rather than guessing.

**Section 7** is a one-off: before `scripts/common.sh` mapped host paths,
`daedalus.sh dev` inherited the container paths from `.env` and `paths.py`
fell back to `backend/data/…`, while Docker wrote to `data/` and `logs/`.
Anyone who ran the dev servers then has a second, stale copy of each database.
`sync.sh` reports them and **does not delete them** — one of them may hold
demo telemetry worth keeping.

### `--check` mode

Prints the same report, changes nothing, and ends with a summary of what would
be done. Useful before a demo, and in CI.

---

## `reset.sh`

Wipe the local databases and rebuild them from the migrations. **Destructive.**

```bash
./reset.sh                # chat, audit and prefs; sensor left alone
./reset.sh --sensor       # also wipe the sensor DB and reseed demo telemetry
./reset.sh --seed         # reseed demo telemetry if the sensor DB is empty
./reset.sh --no-backup    # skip the snapshot (not recommended)
./reset.sh --yes          # don't ask — for scripts
./reset.sh --help
```

Sequence:

1. **Refuses if the stack is running.** Deleting a SQLite file while a process
   holds it open leaves that process writing to a deleted inode: the app looks
   fine, then loses everything on restart. Stop the stack first.
2. **Reports what will be destroyed** — each file with its live row counts
   (`3 preferences`, `142 sessions · 891 messages`), read from the app's own
   path resolution so it names the files that will actually be deleted.
3. **Confirms.** `--sensor` requires typing `sensor` as a second confirmation.
4. **Snapshots first**, into `backups/<timestamp>/`, using `VACUUM INTO` — not
   `cp`, which on a live WAL database captures the main file without its
   pending frames and produces a torn copy that may not even open. This is
   what makes a reset recoverable.
5. **Deletes**, including the `-wal` and `-shm` sidecars. Leaving a WAL beside
   a fresh main file is how a "reset" database comes back with the old rows.
6. **Rebuilds the schema** by running the migrations.
7. **Seeds demo telemetry** if asked. `seed_demo()` refuses when rows already
   exist, so it can only ever fill an empty database.

### Why the sensor database is excluded by default

Daedalus does not own it. The SCADA ingestion subsystem writes it, Daedalus
opens it read-only, and on the lab machine that file may be real reactor
telemetry that nothing else has a copy of. Destroying it has to be something
you asked for explicitly, not something a reset quietly did — the same
reasoning as Rule 2 in [`PROJECT.md`](PROJECT.md) §3.

---

## `python -m app.db.migrate`

The migration CLI. Run from `backend/`, or reach it through
`./daedalus.sh migrate`, which supplies the host paths for you.

| Subcommand | Does |
|---|---|
| `status [store]` | What is applied, what is pending, per store |
| `up [store]` | Apply pending migrations |
| `check [store]` | `PRAGMA quick_check` and file size for each database |
| `backup [store] --into DIR` | `VACUUM INTO` snapshot of each database (default `<repo>/backups/`) |
| `repair <store>` | Re-record checksums after a knowingly cosmetic edit |
| `new <store> <name>` | Scaffold the next numbered migration file |

Omit `[store]` to act on all of them: `prefs`, `audit`, `chat`.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Up to date |
| `2` | Migrations pending |
| `1` | Something is wrong — drift, a gap, a missing file, corruption |

Distinct codes so CI can tell "needs migrating" from "is broken".

### Writing a migration

```bash
cd backend && python -m app.db.migrate new chat add_pinned_flag
# → app/db/migrations/chat/002_add_pinned_flag.sql
```

Four rules, all enforced rather than documented:

1. **Append-only.** Never edit a file that has run anywhere. The runner stores
   a checksum and refuses to proceed if an applied file changed — at that
   point the code's idea of the schema and the database's real shape have
   diverged silently. `repair` exists for a genuinely cosmetic edit and
   asserts the SQL is unchanged in meaning.
2. **Numbers never fill gaps.** Adding `003` after `004` is applied is
   rejected: anyone who already ran `004` would never get `003`.
3. **Each file is one transaction.** Bad SQL rolls that file back entirely;
   earlier files stay applied. A database is never left half-migrated.
4. **Failure at startup is fatal.** Serving requests against a database whose
   shape the code disagrees with corrupts data in ways found much later.

`sensor` is deliberately unmanaged — see the note above about not owning it.

---

## `scripts/common.sh`

A library, not a command. One copy means a fix to the `.env` backfill or the
path handling reaches all three scripts at once.

Running it does nothing useful — it only defines functions, and those are lost
when the child shell it ran in exits. `.` (source) runs it in the *current*
shell, which is what makes the definitions stick. Executing it directly prints
that explanation and exits 1, rather than leaving you with a bare "Permission
denied" or a shell that silently gained nothing.

To use the helpers yourself:

```bash
cd "$(git rev-parse --show-toplevel)"
. ./scripts/common.sh
host_py -c "from app.db import chat_store; print(chat_store.stats())"
```

| Function | Does |
|---|---|
| `say` · `ok` · `warn` · `err` · `info` · `head_` · `fail` | Output. Colour only when attached to a terminal, so piping to a file or CI log stays readable |
| `have <cmd>` | Is this on `PATH`? |
| `compose …` | `docker compose` (v2) or legacy `docker-compose`, whichever exists |
| `env_missing_keys` | Keys in `.env.example` absent from `.env` |
| `env_backfill` | Appends those keys with their example values; prints what it added |
| `ensure_env` | Create `.env` on first run, top it up afterwards |
| `load_env` | Export `.env` into the shell; already-exported values win |
| `ensure_dirs` | Create the runtime directories |
| `backend_deps_stale` · `frontend_deps_stale` | Lockfile newer than the installed tree |
| `host_py …` | The venv interpreter, with **host** data paths, run from `backend/` |
| `host_uvicorn …` | The dev server, same mapping |
| `migrate_cli …` | `host_py -m app.db.migrate` |
| `require_venv` | Fail with a useful message if `backend/.venv` is missing |
| `wait_for_api [port]` | Poll `/api/health` for 60s |
| `check_ollama` | Warn, never fail — only inference needs it. Tries to start it, and offers to install it when interactive |
| `host_ollama_url` | `OLLAMA_BASE_URL` as seen *from the host*: rewrites `host.docker.internal`, leaves a real remote alone, and stays unset rather than becoming `""` |
| `host_chroma_url` | `CHROMA_URL` as seen *from the host*: rewrites the compose service name `http://chromadb:8000` to `127.0.0.1:${CHROMA_PORT:-8001}`, the published port of the same container |
| `ensure_chroma` | Start the `chromadb` container for `dev --host`, waiting for its heartbeat. Warns and continues when Docker is absent — a missing vector store must not block the rest of the stack |
| `host_searxng_url` | Same mapping for the optional search container. There is deliberately no `ensure_searxng`: Track 1 cannot work without a vector store, so `dev` starts one, but nothing in Daedalus needs a search engine to run and a project whose first rule is "the runtime is offline" should not quietly start one |
| `COMPOSE_FILES` | Extra `-f` arguments. `dev` sets it to layer `docker-compose.dev.yml`; everything else leaves it empty and gets the shipping stack |
| `stack_running` | Is the app container up? |
| `image_is_stale` | Is any source file newer than the last successful build? |
| `mark_build` | Touch `.daedalus-build-stamp` after a successful build |

---

## Host and container paths

The paths in `.env` are as seen **inside the container**:

```
./data          →  /data        sensor DB, chat DB, documents, chroma
./logs          →  /logs        audit logs
./backend/data  →  /app/data    UI preferences
```

Sourcing `.env` and then running the backend **on the host** points it at
`/data` and `/logs`, which do not exist there — so `paths.py` fell back to
`backend/data/…` and the dev servers quietly used a different set of databases
from the container. That was a real bug; `host_py` and `host_uvicorn` fix it
by mapping the paths back, so `dev` and `start` read and write the same files.

`OLLAMA_BASE_URL` gets the same treatment, via `host_ollama_url`. `.env` holds
the container's view — `host.docker.internal` — which does not resolve outside
Docker, so the backend paid a full DNS timeout on every call before falling
back. A URL pointing at a *real* remote is left alone: quietly answering from a
daemon on this machine instead would attribute a benchmark to the wrong
hardware. And an unset variable stays unset rather than becoming the empty
string, which the backend would read literally and end up with no candidate URL
at all.

`CHROMA_URL` has the identical problem and the identical cure, via
`host_chroma_url`. `.env` holds `http://chromadb:8000` — a **compose service
name**, which does not resolve on the host — so the dev servers reported the
vector store as *unreachable* rather than as *not running*, which sends you
looking for the wrong fault. `docker-compose.yml` publishes the service on
`127.0.0.1:${CHROMA_PORT:-8001}`, and that is the host's address for the same
container.

> Leaving `CHROMA_URL` unset is **not** a working fallback on a default install.
> The docs say unset means embedded mode, and embedded mode needs the full
> `chromadb` package; `requirements.txt` ships `chromadb-client`, which is
> HTTP-only. So unset means no vector store at all, which is why `dev` starts the
> container rather than relying on the fallback.

The mapping is applied **per command, never exported**, because
`docker compose` reads the shell environment in preference to `.env`:
exporting host paths globally would hand them to the container, which is
precisely backwards.

Anything you run against the backend by hand needs the same treatment. Use
`host_py`:

```bash
. ./scripts/common.sh
host_py -c "from app.db import chat_store; print(chat_store.stats())"
```
