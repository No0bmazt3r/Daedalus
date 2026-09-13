# Scripts Reference

Every command Daedalus ships, what it does, and when to reach for it.

Three entry points at the repo root, sharing one helper library:

```
daedalus.sh    run it            setup · start · dev · stop · logs · rebuild · status · migrate
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
| Running it like production | `./daedalus.sh start` |
| Added a migration | `./daedalus.sh migrate` |
| Database is a mess | `./reset.sh` |
| Nothing works and you want a clean slate | `./daedalus.sh setup` then `./reset.sh` |

---

## `daedalus.sh`

The entry point. Every command loads `.env` (anything already exported wins),
so `DAEDALUS_PORT=9000 ./daedalus.sh dev` works.

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
   it; only model inference needs it.

### `start` (alias `up`)

Builds if needed and starts the container stack, then polls `/api/health` for
up to 60 seconds. On success it prints the dashboard and API-docs URLs; on
failure it dumps the last 40 lines of container logs and exits non-zero, so a
broken start is diagnosable without a second command.

Extra arguments pass through to `docker compose up`, which is how `rebuild`
reuses it.

### `dev`

Hot-reload development, no Docker. Two processes: `uvicorn --reload` on
`BACKEND_PORT` (8000) and Vite on `FRONTEND_PORT` (5173), with Vite proxying
`/api` to uvicorn. Ctrl-C stops both — the backend is killed by an `EXIT INT
TERM` trap, so it cannot be orphaned.

Refuses to start if `backend/.venv` or `frontend/node_modules` is missing, and
runs migrations first so a schema failure is reported before two dev servers
start writing to the terminal.

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
| 7 | **Orphaned databases** | Stale copies under `backend/data/` from before the host-path fix |
| 8 | **Containers** | A running stack is serving pre-pull code |

**Section 2 is the one that earns its keep.** `.env` is git-ignored, so a pull
never updates it. When someone adds a setting, your app silently falls back to
a config default and misbehaves in a way that looks nothing like a missing
variable. Missing keys are appended with `.env.example`'s values; **existing
values are never touched**, and you are told to check the new ones suit your
machine.

**Section 5 is the one that matters most after a pull.** A teammate's
migration arrives as a file, and until it runs, the code and the database
disagree about the shape of the data.

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

Sourced by all three scripts; not executable on its own. One copy means a fix
to the `.env` backfill or the path handling reaches everything at once.

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
| `check_ollama` | Warn, never fail — only inference needs it |
| `stack_running` | Is the app container up? |

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
