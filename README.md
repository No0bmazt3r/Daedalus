<div align="center">

# Daedalus

**A 100% local, read-only conversational AI layer for real-time CO₂ sorption reactor monitoring.**

Ask a reactor plain-language questions. Get grounded, cited answers.
No cloud. No hallucinated sensor values. No write path to the plant.

</div>

---

## What it is

CO2SorptionDT is an existing PyQt5 SCADA application monitoring a lab-scale CO₂
sorption reactor, logging temperature, pressure, pH, level and NDIR CO₂
concentration to SQLite every 5 seconds. Understanding what the reactor is doing
today means reading raw graphs, knowing SCADA jargon, and manually
cross-referencing SOP documents and anomaly logs.

Daedalus sits **on top of** that stack — never replacing it — so anyone can ask:

> *"Is the reactor running fine right now?"*
> *"Why did the CO₂ reading spike at 10:00?"*
> *"What do I do if the NDIR reading drifts?"*
> *"Was there an anomaly this morning?"*

…and get an answer traceable to the exact database row or SOP page it came from.

**Final Year Project** — BCS (Hons), Universiti Teknologi PETRONAS.
Full specification: **[`docs/PROJECT.md`](docs/PROJECT.md)**.
All documentation lives in **[`docs/`](docs/)** — start at [`docs/README.md`](docs/README.md).

---

## The three rules that shape everything

1. **Fully local.** No cloud APIs in the production path. Cloud models exist as
   evaluation baselines: the console lets you point one chat turn at a hosted
   model for comparison, and that turn is logged `chat_cloud`, labelled in the
   transcript, and excluded from every production latency figure. Recorded, not
   merely forbidden — see [`docs/PROJECT.md`](docs/PROJECT.md) §3.
2. **Read-only toward the plant.** The AI cannot write to SCADA, actuators or
   sensors — enforced by the SQLite driver and the tool registry, not by
   prompting. The automated ball valves are write-only from SCADA, so their true
   state can't be verified downstream; a hallucinated write could move real
   hardware. Removing the capability entirely eliminates the risk class.
3. **The model never invents numbers.** Every value is fetched by a
   deterministic tool. The LLM only phrases what was retrieved — and says
   "I don't have that information" when nothing was.

---

## Quick start

```bash
git clone <repo> && cd Daedalus
./daedalus.sh setup      # one-time: checks tools, installs deps, creates .env
./daedalus.sh start      # build and run
```

Open **<http://localhost:8000>**.

Two ways to run it, and both are containers:

| | Command | What you get |
|---|---|---|
| **Run it** | `./daedalus.sh start` | One image serving the API and the built dashboard on **:8000** |
| **Work on it** | `./daedalus.sh dev` | Same image, source bind-mounted, `uvicorn --reload` on **:8000** and Vite on **:5173** |

`dev` is the one to use while editing — saving a file reloads the backend in
place, and Vite hot-reloads the UI. Ctrl-C stops Vite; `./daedalus.sh stop`
stops everything.

Optional extras, off by default:

```bash
./daedalus.sh start --with-ollama    # run Ollama in a container too
./daedalus.sh start --with-search    # run SearXNG, for sourcing corpus documents
./daedalus.sh dev   --host           # dev the old way: two processes, no containers
```

`setup` is safe to re-run. It never overwrites your `.env` and never touches a
database that already has data — re-running just tops up any settings added to
`.env.example` since.

### Commands

| Command | Does |
|---|---|
| `./daedalus.sh setup` | One-time: verify prerequisites, install deps, create `.env`, make runtime dirs |
| `./daedalus.sh start` | Build (if needed) and start the container stack |
| `./daedalus.sh dev` | Hot-reload dev stack in containers — source bind-mounted, uvicorn and Vite reload in place |
| `./daedalus.sh stop` | Stop the stack |
| `./daedalus.sh logs` | Follow logs |
| `./daedalus.sh rebuild` | Force a clean image rebuild, then start |
| `./daedalus.sh status` | What's running, plus health of all five databases |
| `./daedalus.sh migrate` | Apply pending schema migrations (`status`, `check`, `backup`, `new`) |

| Flag | On | Does |
|---|---|---|
| `--with-ollama` | `start`, `dev` | Run Ollama as a container instead of on the host |
| `--with-search` | `start`, `dev` | Run SearXNG — a self-hosted search engine for finding corpus documents. Off by default: Rule 1 says the runtime is offline, so it is started while sourcing and stopped afterwards |
| `--host` | `dev` | Run the two dev servers on your machine instead of in containers. Quickest way to attach a debugger |

Two more scripts sit alongside it:

| Script | Does | Safe? |
|---|---|---|
| `./sync.sh` | After a `git pull`: dependencies, `.env` backfill, migrations, integrity check | Yes — re-runnable, destroys nothing |
| `./sync.sh --check` | Reports what *would* change and touches nothing | Yes |
| `./reset.sh` | Wipes the chat, audit and prefs databases and rebuilds them from the migrations | **No** — snapshots first, then deletes |
| `./reset.sh --sensor` | Also wipes the sensor database and reseeds demo telemetry | **No** — asks twice |

`reset.sh` leaves the sensor database alone by default: Daedalus does not own
that file, and on a lab machine it may hold real reactor telemetry. It also
refuses to run while the stack is up, because deleting a SQLite file out from
under a live process leaves it writing to a deleted inode.

Shared helpers live in `scripts/common.sh`, so a fix to the `.env` backfill or
the path handling reaches all three scripts at once.

**Every command, every flag, and why each safeguard is there:**
[`docs/SCRIPTS.md`](docs/SCRIPTS.md).

> **Host and container see the same data.** The paths in `.env` are as seen
> *inside the container* (`/data`, `/logs`, `/app/data`). The scripts map them
> back to `./data`, `./logs` and `./backend/data` when running the backend on
> your machine, so `dev` and `start` are not quietly two different databases.

### Prerequisites

| Tool | Needed for |
|---|---|
| **Docker** | The container stack. `setup` checks the daemon is reachable |
| **Node 20+** and **pnpm** | Frontend. `setup` enables pnpm via corepack if missing |
| **Python 3.11+** | Only for `./daedalus.sh dev --host` and the `migrate`/`sync`/`reset` scripts. The container path does not need it |
| **Ollama** *(optional)* | Model inference. The dashboard runs fine without it |

Ollama runs on the **host** by default — GPU passthrough is far simpler there
and the model cache survives container rebuilds:

```bash
ollama serve
ollama pull qwen3:1.7b
```

---

## Configuration

Everything lives in **`.env`**, created from [`.env.example`](.env.example) by
`setup`. Both `docker compose` and `daedalus.sh` read it, so one edit reaches
the container stack and the dev servers alike.

| Setting | Default | Controls |
|---|---|---|
| `DAEDALUS_PORT` | `8000` | Dashboard + API |
| `CHROMA_PORT` | `8001` | ChromaDB on the host |
| `BACKEND_PORT` / `FRONTEND_PORT` | `8000` / `5173` | `dev` mode only |
| `DAEDALUS_DATA_DIR` | `/data` | Sensor DB, documents, embedded Chroma |
| `DAEDALUS_LOG_DIR` | `/logs` | Audit logs |
| `CHROMA_URL` | `http://chromadb:8000` | Vector store. Unset it for embedded mode |
| `DAEDALUS_PREFS_DB` | `/app/data/prefs.db` | UI preferences |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Model runtime |

Paths are as seen **inside the container**. The host directories backing them
are the volume mounts in `docker-compose.yml`:

```
./data          ->  /data       sensor DB, documents, embedded chroma
./logs          ->  /logs       audit logs
./backend/data  ->  /app/data   UI preferences
```

To point Daedalus at a **real reactor database**, change the `./data` mount to
the directory holding it. It is opened read-only regardless.

There are no secrets in `.env.example`, deliberately — Daedalus runs fully
local with no cloud APIs. `.env` is gitignored if that ever changes.

---

## The five databases

Separate on purpose: a fault in ingestion or logging physically cannot reach the
sensor data of record. **Settings → Databases** shows all five live, and
`./daedalus.sh status` prints the same from the terminal.

| Store | Engine | Access | Holds |
|---|---|---|---|
| **Sensor** | SQLite | **read-only** | IoT telemetry written by the SCADA subsystem |
| **Audit** | SQLite | read/write | chat · tool-call · retrieval · model · error · feedback · memory logs |
| **Chat** | SQLite | read/write | conversation sessions and messages — the assistant's memory |
| **Vector** | ChromaDB | read/write | embedded SOP/manual/anomaly chunks for RAG |
| **Prefs** | SQLite | read/write | UI state, kept out of the browser |

The read-only boundary is the SQLite driver's, not a convention:

```python
conn = sqlite3.connect(f"file:{SENSOR_DB}?mode=ro", uri=True)
```

INSERT, UPDATE, DELETE and DROP all raise; reads keep working. A prompt
injection cannot reach below that line.

**Why SQLite, for all of it.** The workload is a few writes a minute — orders
of magnitude below where SQLite starts to care. More importantly, the
read-only boundary above *is* an SQLite property: in a client-server database
the equivalent is a `GRANT`, enforced by a process a misconfiguration can
undo, and not something you can show an examiner in one line. The sensor DB is
also already SQLite and owned by the ingestion subsystem, so mixing engines on
a file we do not control would add risk for nothing.

**Why chat and audit are two files**, though both hold conversation text: a
user owns their transcript and may delete it, while audit rows are append-only
evidence that a response was grounded. Separate files make that a property of
the filesystem rather than a promise about our DELETE statements.

Each writable store has a **versioned schema** — numbered SQL files applied
once, in order, inside a transaction, recorded in the database itself and
applied automatically at startup. See `backend/README.md`.

**No telemetry yet?** Settings → Databases → *Generate demo data* seeds a
plausible run offline. It refuses if data already exists.

---

## Repository layout

```
├── frontend/            React dashboard (Zone 4)
│   ├── src/
│   │   ├── components/  Chat, sidebar, theme modal, settings
│   │   ├── contexts/    Theme, settings and conversation state
│   │   ├── hooks/       Draggable, resizable sidebar
│   │   └── lib/         Theme engine, canvas effects, API clients
│   ├── public/
│   └── package.json     …and the rest of the Vite/TS toolchain
│
├── backend/             FastAPI service (Zone 3)
│   ├── app/
│   │   ├── api/         Route handlers — HTTP only
│   │   ├── services/    Session policy, context-window assembly
│   │   ├── models/      Pydantic wire contracts
│   │   └── db/          The five stores, and schema migrations
│   └── requirements.txt
│
├── docs/                All documentation
│   ├── README.md        Index — start here
│   ├── PROJECT.md       Canonical specification
│   ├── FEATURES.md      What's actually built
│   ├── SCRIPTS.md       Every script, command and flag
│   ├── research/        FYP1 research specs    ─┐ historical,
│   └── architecture/    11-layer design specs  ─┘ superseded by PROJECT.md
│
├── scripts/
│   └── common.sh        Shared shell helpers for the three scripts below
│
├── data/                Runtime: sensor DB, chat DB, documents  (gitignored)
├── logs/                Runtime: audit logs                     (gitignored)
├── backups/             Snapshots from `migrate backup`         (gitignored)
│
├── .env.example         Configuration template
├── Dockerfile           Multi-stage: builds frontend, served by backend
├── docker-compose.yml   App + ChromaDB (+ optional Ollama)
├── daedalus.sh          Entry point — setup, start, dev, migrate
├── docker-compose.dev.yml  Dev overlay — bind-mounted source, hot reload
├── config/searxng/      Settings template for the optional search container
├── sync.sh              Get a checkout working after a pull (safe)
├── reset.sh             Wipe and rebuild the databases (destructive)
├── ACKNOWLEDGMENTS.md   What this project borrowed, and from whom
└── TODO.md              Roadmap
```

Frontend and backend are fully separated: the frontend is a pure client of the
API, and the backend has no knowledge of React. The container proves it —
`Dockerfile` builds the bundle in one stage and serves it from the other.

---

## Status

Zone 4 (the dashboard) and the data layer exist. The AI layer — the actual
research contribution — is the work ahead. Tracked in [`TODO.md`](TODO.md),
detailed in [`docs/FEATURES.md`](docs/FEATURES.md).

### Built

| Area | What works |
|---|---|
| **Dashboard** | React 19 · Vite 8 · TanStack Router · Tailwind v4 · shadcn/base-ui |
| **Chat interface** | Message list, composer, model selector, incognito — wired end to end. Replies stream token by token from a real local model and survive a reload mid-answer. *No retrieval or tool-calling yet, so it answers from the conversation alone* |
| **Chat history** | Real sidebar from `GET /api/sessions` — select, inline rename, delete, filter; transcripts reload on reopen |
| **Dynamic Models**| Unified `/api/system/models` querying Ollama + cloud baselines, with per-model capability badges (reasoning · tools · vision). Cloud models are selectable but marked, and their turns are logged apart |
| **Theme engine** | 16 themes · live editing of 7 base + 14 per-zone colours · derived syntax ramps · harmony generator · font/density/scale · frosted glass · import/export |
| **Typography** | **Monocraft** — the Minecraft typeface — as the default face, bundled and self-hosted; four alternatives in the Font selector |
| **Background effects** | 13 options, 11 canvas-animated — including Nexus, Aurora, Bubbles and Voxels. Cursor reactivity was built and then deliberately removed: on a monitoring console, the only thing moving for a reason should be the answer on screen |
| **Attention dimming** | The sidebar and the chat surfaces sit back translucent while the pointer and focus are elsewhere |
| **Floating windows** | Settings, Data stores, the Forge and the theme palette open as draggable, resizable windows with **Peek** (fade to see the page behind) and **minimize** (collapse to a chip beside the incognito toggle, restored exactly as you left it). Clicking outside minimizes rather than closes, so a stray click never discards what you were doing |
| **Loading skeletons** | Placeholders shaped like the content they precede, in a pixel or smooth style — switchable in Theme → Customize |
| **Data stores** | The five stores in the sidebar under the chats — expand one, click a table, read its rows in a floating window |
| **Hardware detection** | RAM · CPU · GPU/VRAM · disk · Ollama. Probed on a background schedule, not on every panel open, and dormant when nobody is looking. Settings → Hardware, and **The Forge**. In a container it says which machine it is describing: GPU passthrough is layered on automatically where the host has one (`--gpu` / `--no-gpu`), and where it is absent the panel names the flag instead of reporting no GPU |
| **The Forge** | Hardware and model console. Estimates memory per model × quantization, scores fit against **both** memory pools (`safe` / `marginal` / `will_not_fit`, GPU / offload / CPU), pulls and deletes via Ollama, benchmarks on a RAG-sized prompt, and commits the choice to `config/model_config.json` |
| **Model discovery** | 37 catalogue entries with every Ollama tag verified against the registry, live Hugging Face GGUF search, and a Custom tab that scores any tag you type. Sizes come from published manifests, so an estimate uses real bytes before anything is downloaded |
| **Model manager** | What is installed, badged SLM or LLM, with per-model usage: runs split by chat and benchmark, token totals, and latency as mean / p50 / p95 |
| **Chat** | `POST /api/chat` resolves the committed model, replays conversation history, streams the answer from Ollama and logs the call. The committed model is always local; a cloud model answers only when explicitly picked, and that turn is logged `chat_cloud` and kept out of every production figure |
| **Accessible theming** | Every colour derives from the selected theme and is floored to WCAG AA: body, muted, accent-as-text, on-accent labels and the three status colours. All 16 shipped themes pass on every role, and custom themes run through the same derivation |
| **Settings** | Registry-driven nav, keyword search, drag-resizable rail, layout persisted server-side. Every panel is built — Databases reports health only |
| **Keyboard shortcuts** | 11 rebindable actions across navigation, conversations and windows. Click a chord, press keys, Enter saves and Escape abandons — nothing commits on the first keypress. Duplicates are shown with the rule that resolves them, unbinding is Backspace, and AltGr is not mistaken for Ctrl+Alt |
| **Appearance** | Nine switches over the app's own furniture — sidebar brand, New, core modules, chat list, data stores, bottom bar; welcome message, incognito button, full-width transcript. Chrome only: nothing switchable can hide an answer, a citation or a refusal |
| **Web search** | Six providers (SearXNG · DuckDuckGo · Brave · Google PSE · Tavily · Serper) with an ordered fallback chain, per-provider credentials and a live probe. A **setup** surface for sourcing corpus documents — SearXNG ships as an optional container tuned for technical literature |
| **Agent tools** | 29 tools in five categories behind a dispatcher that checks declared effects, validates arguments and stamps result integrity before the function is entered. Every call writes a `tool_logs` row. Untrusted output is fenced with a per-call nonce before it reaches a prompt |
| **Tool policy** | Two axes, deliberately separate: four capability locks (`network_egress` · `write` · `admin` · `execute_code`) that say what the machine may do while a result is recorded, and a per-tool switch that says which tools the model is offered. A switched-off tool leaves the schema list and is refused if asked for by name. Every parameter carries a working example, so a trial run is one click |
| **System maintenance** | Settings → System: a filterable viewer over the backend's own rotating log, a credential-free backup/restore, and a per-category Danger Zone with typed confirmation. The sensor database is absent from all three by rule |
| **Container control** | Settings → Search can start and stop the SearXNG container, when a Docker socket is mounted. Off by default — the socket is a host-level privilege, and the agent's `bash` tool runs in the same container |
| **MCP** | Connect to external tool servers over stdio or HTTP. Each server's tool list is **pinned and hashed**, so a server that grows a tool is reported as drift and the new tool is refused — the protocol is designed to be dynamic, and §7.2 needs it not to be |
| **Backend** | FastAPI · health + system endpoints · preference store · flash-free first paint |
| **Conversation memory** | Session store, transcripts, rolling-summary and token-budgeted context assembly, incognito |
| **Data stores** | All five wired, containerised, health-reported, each with a versioned schema |
| **Migrations** | Numbered SQL files, applied in a transaction at startup, with drift and gap detection |
| **Deployment** | Single-image build + ChromaDB, one-command startup, and a dev overlay that runs the same image with hot reload |

### Not built yet

Knowledge ingestion, both retrieval tracks, the deterministic tool layer, the
full orchestration flow and the evaluation harness.

Chat answers now: the serving path is wired, so a message goes to a real local
model, streams token by token, and the transcript persists. A generation
outlives the request that started it, so reloading mid-answer picks it back up.
What it does *not* do yet is retrieve — there is no evidence pack and no
tool-calling, so it answers from the conversation alone.

---

## How it will work

```
User question
     ↓
FastAPI  ── normalise → classify intent → SAFETY GUARD
     ↓
     ├─ live/trend/anomaly  → deterministic SQL tools ─→ SQLite (read-only)
     └─ SOP/troubleshooting → Track 1 vector RAG  ─→ ChromaDB
                             Track 2 agentic GraphRAG ─→ knowledge graph
     ↓
Evidence pack → prompt → Ollama (local SLM) → response validator
     ↓
Answer + citations + tool trace
```

A control-intent question ("open valve ABV-1") is refused at the safety guard —
before any tool runs and without an LLM call at all.

### The research contribution

Two retrieval architectures, built and benchmarked head-to-head on an identical
query set with an identical model, so the *architecture* is the only variable:

| | Track 1 — Traditional RAG | Track 2 — Agentic GraphRAG |
|---|---|---|
| **Retrieval** | Vector similarity over chunks | Multi-hop traversal of a knowledge graph |
| **Store** | ChromaDB | NetworkX (Kùzu as a stretch) |
| **Shape** | One retrieval → one generation | Agent loop: retrieve → assess → re-retrieve |
| **Strength** | Fast, simple, strong single-hop | Explicit relationships, genuine multi-hop |
| **Cost** | Weak on multi-hop | Higher latency, silent gaps when a relation was never authored |

Measured on groundedness, retrieval precision/recall, latency (mean + p95),
multi-hop success and refusal correctness.

> Traditional RAG matching GraphRAG at a fraction of the latency would be a
> perfectly valid — arguably more interesting — result. The experiment is
> designed to find out, not to confirm.

**Targets:** <3s end-to-end · >80% retrieval precision · <10% hallucination rate.

---

## Architecture

```
Zone 1  Physical reactor ─ sensors, ABV valves          pre-existing
Zone 2  SCADA acquisition ─ CO2SorptionDT → SQLite      pre-existing
          │ read-only  ◄── the safety boundary
Zone 3  AI layer ─ FastAPI · tools · RAG · Ollama       ← this project
Zone 4  Presentation ─ React dashboard                  ← this project
```

---

## Development

```bash
./daedalus.sh dev
```

Layers `docker-compose.dev.yml` over the base stack: the same image at its `dev`
stage with `backend/app` bind-mounted read-only, `uvicorn --reload` watching it
on :8000, and Vite in its own container on :5173 proxying `/api` across. Saving a
file reloads the backend in place; the UI hot-reloads. Ctrl-C ends the Vite
session and leaves the backend running — `./daedalus.sh stop` stops everything.

**Why the container rather than your machine.** Every address in `.env` is
written from the container's point of view — `http://chromadb:8000`,
`http://searxng:8080` — and none of them resolve on the host, so the host path
needs three helpers in `scripts/common.sh` whose only job is rewriting them back
to published ports. In here they are simply the addresses, and `/data`, `/logs`
and `/config` mean what they mean in the image that ships. It also puts the
agent's `bash` and `python` tools behind a kernel boundary instead of a pattern
denylist.

<details>
<summary>Running the dev servers on your machine instead</summary>

```bash
./daedalus.sh dev --host
```

Kept because a debugger attaches to a local process in one step, and a container
that will not start should not stop you working. Needs `backend/.venv` and
`frontend/node_modules`, both created by `setup`.

```bash
# Or drive the two yourself
backend/.venv/bin/uvicorn app.main:app --reload --port 8000 --app-dir backend
cd frontend && pnpm dev
```

</details>

<details>
<summary>Checks</summary>

```bash
cd frontend
npx tsc -b          # typecheck
npm run build       # production build
npx oxlint src      # lint

cd ../backend
.venv/bin/python -m compileall -q app
```

</details>

---

## Tech stack

**Frontend** — React 19 · TypeScript · Vite 8 · TanStack Router · Tailwind v4 · shadcn/base-ui · Lucide
**Backend** — FastAPI · Pydantic/PydanticAI · SQLite (WAL) · Uvicorn
**AI** — Ollama (Qwen3 1.7B · Phi-3 Mini · Gemma 3 1B, Q4_K_M) · ChromaDB · NetworkX · nomic-embed-text
**Ops** — Docker · single-image multi-stage build

---

## Scope

**Out of scope, deliberately:** cloud LLMs in production · any write path to the
plant · cybersecurity/IIoT hardening · automated chart generation (existing SCADA
covers it) · physical hardware changes · auth/multi-tenancy · fine-tuning.

**Deferred to Phase 2:** the PyQt5 embedded tab · multi-device support · Kùzu
backend · multi-lab LAN deployment.

---

## Credits

The presentation layer was built with
**[Odysseus](https://github.com/odysseus-dev/odysseus)** open in the next
window — a self-hosted AI workspace created by **Felix Kjellberg (PewDiePie)**
and its contributors. Daedalus's theme engine, settings shell and preference
API were modelled on how Odysseus does those things, and the
`GET`/`PUT /api/prefs/<key>` contract is deliberately the same shape.

**Daedalus is not a fork of it.** Odysseus is a Python/Flask application with
a vanilla-JavaScript frontend and contains no TypeScript; the React components
here were written from scratch. No Odysseus source code is present in this
repository. That distinction is also a licensing one — Odysseus is AGPL-3.0,
and adapting its code would oblige this project to be AGPL-3.0 too.

Full attribution, including the stack and the wider project team:
[`ACKNOWLEDGMENTS.md`](ACKNOWLEDGMENTS.md).

---

## License

See [`LICENSE`](LICENSE).
