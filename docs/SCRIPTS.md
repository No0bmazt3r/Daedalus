# Scripts Reference

Every command Daedalus ships, what it does, and when to reach for it.

Three entry points at the repo root, sharing one helper library:

```
daedalus.sh    run it            setup · dev · start · stop · status · migrate
               flags             --with-search
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
| Sourcing documents for the corpus | `./daedalus.sh dev --with-search` (needs Docker) |
| Using it rather than changing it | `./daedalus.sh start` |
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

1. **Verifies prerequisites** — `node`, `python3`, `pnpm`. Enables pnpm via
   `corepack` if it is missing but corepack exists. Stops with a list if
   anything is absent, rather than failing halfway through. Docker is not
   checked: nothing but the optional SearXNG uses it.
2. **Creates `.env`** from `.env.example`, or tops up an existing one with any
   keys it is missing.
3. **Installs frontend dependencies** — `pnpm install`.
4. **Creates `backend/.venv`** and installs `requirements.txt`, runs
   `ensure_embedded_chroma`, then writes `.venv/.requirements-stamp` so
   `sync.sh` can later tell whether the installed packages have drifted.
5. **Creates runtime directories** — `data/sqlite`, `data/documents`, `logs`,
   `backend/data`.
6. **Applies migrations**, so a fresh clone has its schema before first run.
7. **Checks for Ollama** — a warning, never fatal. The dashboard works without
   it; only model inference needs it. If Ollama is installed but not running it
   tries to start it (systemd, or `brew services` / the app on macOS); if it is
   not installed at all, it offers to install it, but only on an interactive
   terminal. Neither path ever blocks a non-interactive run.

### `dev` (alias `local`) — the default

Everything on the host: `uvicorn --reload` on `BACKEND_PORT` (8000) and Vite
on `FRONTEND_PORT` (5173), proxying `/api` across. ChromaDB is embedded in the
API process (`data/chroma`), and Ollama is the host's own install.

Refuses to start if `backend/.venv` or `frontend/node_modules` is missing, makes
sure the venv has the full `chromadb` package, and runs migrations first so a
schema failure is reported before two servers start writing to the terminal.
Ctrl-C stops both — the backend is killed by an `EXIT INT TERM` trap, so it
cannot be orphaned.

uvicorn watches `backend/app` only (`--reload-dir`). Its default is the whole
working directory, `frontend/node_modules` included, which is CPU spent on
nothing.

**Why not containers any more.** Daedalus used to run as a container stack
(app + ChromaDB, with a dev overlay and a GPU overlay). On a single-user
localhost install that bought nothing the host lacks, and the Docker VM under
WSL held gigabytes of memory for it. It also needed a translation layer —
`.env` held container addresses (`http://chromadb:8000`,
`host.docker.internal`) that had to be rewritten for anything run on the host.
Without containers the addresses are simply the addresses.

#### Starting SearXNG

`dev` and `start` both call `ensure_searxng` once the API is healthy. It asks
`/api/search/config` which provider is selected and whether it is reachable, and
starts the container only when the answer is *SearXNG, and no*.
`--with-search` starts it regardless. Without Docker it warns and carries on —
web search is a setup surface, not the answer path.

This was deliberately absent at first, on the reasoning that a project whose
first rule is "the runtime is offline" should not quietly start a search engine.
That still holds for *quietly* — and stops holding once somebody has gone into
Settings and chosen SearXNG. At that point not starting it ignores a stated
choice, and the symptom is a Search panel that looks configured and fails on
every query. Nothing starts for a provider nobody picked.

The check is only trustworthy because `ready` now means **reachable** rather
than **configured** — see the note in `services/web_search.py`.

### `start` (alias `up`)

The same preparation as `dev`, then builds the dashboard once into
`frontend/dist` and runs a single uvicorn process on `DAEDALUS_PORT` (8000)
serving both the API and the bundle (`DAEDALUS_STATIC_DIR`). No file watchers,
no Vite — the lighter way to run while using the app rather than changing it.
Polls `/api/health` for up to 60 seconds and exits non-zero if it never
answers. Runs in the foreground; Ctrl-C stops it.

### `stop` (alias `down`)

Stops the SearXNG container, the only thing Daedalus ever leaves running in
the background. The servers stop with Ctrl-C in their own terminal.

### `status`

The health of all five stores, read from
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
| `--with-search` | `dev`, `start` | Also start the SearXNG container (needs Docker) |
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

It runs seven checks in order:

| # | Section | What it catches |
|---|---|---|
| 1 | **Prerequisites** | Missing `python3` (fatal), `pnpm` (skips frontend) |
| 2 | **Configuration** | A teammate added a key to `.env.example`; your git-ignored `.env` never got it |
| 3 | **Backend dependencies** | `requirements.txt` changed since you last installed. Also swaps an old venv's `chromadb-client` for the full `chromadb` |
| 4 | **Frontend dependencies** | `pnpm-lock.yaml` is newer than `node_modules` |
| 5 | **Database schema** | A pulled migration has not been applied |
| 6 | **Database integrity** | `PRAGMA quick_check` on every store |
| 7 | **Orphaned databases** | Stale stores and directories under `backend/data/`, whether from before the host-path fix or recreated since |

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

1. **Refuses if Daedalus is running (/api/health answers).** Deleting a SQLite file while a process
   holds it open leaves that process writing to a deleted inode: the app looks
   fine, then loses everything on restart. Stop it first (Ctrl-C).
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
| `have_compose` | Is a usable `docker compose` (daemon reachable) or `docker-compose` present? Optional — only SearXNG needs it |
| `compose …` | `docker compose` (v2) or legacy `docker-compose`, whichever exists |
| `env_missing_keys` | Keys in `.env.example` absent from `.env` |
| `env_backfill` | Appends those keys with their example values; prints what it added |
| `ensure_env` | Create `.env` on first run, top it up afterwards |
| `load_env` | Export `.env` into the shell; already-exported values win. Drops a leftover `CHROMA_URL=http://chromadb:8000`, with a warning |
| `ensure_dirs` | Create the runtime directories |
| `backend_deps_stale` · `frontend_deps_stale` | Lockfile newer than the installed tree |
| `host_py …` | The venv interpreter, with **host** data paths, run from `backend/` |
| `host_uvicorn …` | The dev server, same mapping |
| `migrate_cli …` | `host_py -m app.db.migrate` |
| `require_venv` | Fail with a useful message if `backend/.venv` is missing |
| `wait_for_api [port]` | Poll `/api/health` for 60s |
| `check_ollama` | Warn, never fail — only inference needs it. Tries to start it, and offers to install it when interactive |
| `host_ollama_url` | `OLLAMA_BASE_URL` for the host: rewrites a container-era `host.docker.internal`, leaves a real remote alone, and stays unset rather than becoming `""` |
| `ensure_embedded_chroma` | Make sure the venv has the full `chromadb` package (embedded store), removing the HTTP-only `chromadb-client` an older venv has |
| `host_searxng_url` | `SEARXNG_URL` for the host: rewrites a container-era `http://searxng:8080` to the published port |
| `ensure_searxng` | Start the search container — **only** when SearXNG is the selected provider and is not answering. Called after `wait_for_api`, because the selection lives in `prefs.db` and the API is what reads it |
| `start_searxng` · `stop_searxng` | Start or stop the SearXNG container; warn and carry on without Docker |

---

## Data paths

All five stores live in the repo:

```
data/sqlite/sensor_readings.db   sensor telemetry
logs/ai_logs.db                  audit logs
data/chroma/                     vector store (embedded)
data/sqlite/chat.db              chat transcripts
backend/data/prefs.db            UI preferences
```

`host_py` and `host_uvicorn` set `DAEDALUS_DATA_DIR`, `DAEDALUS_LOG_DIR`,
`DAEDALUS_CHAT_DB` and `DAEDALUS_PREFS_DB` to those locations — absolute, per
command — so every entry point resolves the same files whatever its working
directory. Without them `paths.py` falls back to `backend/data/…`, which is how
the stale copies `sync.sh` reports were made. An old `.env` still holding the
container-era paths (`/data`, `/logs`, `/app/data`) is harmless for the same
reason: the scripts' values win.

`OLLAMA_BASE_URL` gets similar treatment, via `host_ollama_url`: a container-era
`host.docker.internal` is rewritten to localhost. A URL pointing at a *real*
remote is left alone — quietly answering from a daemon on this machine instead
would attribute a benchmark to the wrong hardware.

Anything you run against the backend by hand needs the same treatment. Use
`host_py`:

```bash
. ./scripts/common.sh
host_py -c "from app.db import chat_store; print(chat_store.stats())"
```
