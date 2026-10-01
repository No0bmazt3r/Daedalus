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
cross-referencing SOP documents and logs.

Daedalus sits **on top of** that stack — never replacing it — so anyone can ask:

> *"Is the reactor running fine right now?"*
> *"Why did the CO₂ reading spike at 10:00?"*
> *"What do I do if the NDIR reading drifts?"*

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
./daedalus.sh dev        # run it, hot-reloading
```

Open **<http://localhost:5173>**.

Everything runs directly on your machine — **no Docker**. The API is one
uvicorn process with ChromaDB embedded in it, the UI is Vite, and Ollama is your
own install. Two ways to run it:

| | Command | What you get |
|---|---|---|
| **Work on it** | `./daedalus.sh dev` | `uvicorn --reload` on **:8000** and Vite on **:5173**; saving a file reloads in place |
| **Use it** | `./daedalus.sh start` | The dashboard built once and served by the API on **:8000** — one process, no file watchers |

Both run in the foreground; Ctrl-C stops everything.

Optional, off by default — and the one thing that still needs Docker:

```bash
./daedalus.sh dev --with-search    # also run SearXNG, for sourcing corpus documents
./daedalus.sh stop                 # stop it again
```

`setup` is safe to re-run. It never overwrites your `.env` and never touches a
database that already has data — re-running just tops up any settings added to
`.env.example` since.

### Commands

| Command | Does |
|---|---|
| `./daedalus.sh setup` | One-time: verify prerequisites, install deps, create `.env`, make runtime dirs |
| `./daedalus.sh dev` | Hot reload: uvicorn and Vite on the host (the default command) |
| `./daedalus.sh start` | Build the dashboard, serve it and the API on one port |
| `./daedalus.sh stop` | Stop the optional SearXNG container |
| `./daedalus.sh status` | Health of all five databases |
| `./daedalus.sh migrate` | Apply pending schema migrations (`status`, `check`, `backup`, `new`) |

| Flag | On | Does |
|---|---|---|
| `--with-search` | `start`, `dev` | Run SearXNG — a self-hosted search engine for finding corpus documents. Needs Docker. Off by default: Rule 1 says the runtime is offline, so it is started while sourcing and stopped afterwards |

Two more scripts sit alongside it:

| Script | Does | Safe? |
|---|---|---|
| `./sync.sh` | After a `git pull`: dependencies, `.env` backfill, migrations, integrity check | Yes — re-runnable, destroys nothing |
| `./sync.sh --check` | Reports what *would* change and touches nothing | Yes |
| `./reset.sh` | Wipes the chat, audit and prefs databases and rebuilds them from the migrations | **No** — snapshots first, then deletes |
| `./reset.sh --sensor` | Also wipes the sensor database and reseeds demo telemetry | **No** — asks twice |

`reset.sh` leaves the sensor database alone by default: Daedalus does not own
that file, and on a lab machine it may hold real reactor telemetry. It also
refuses to run while Daedalus is up, because deleting a SQLite file out from
under a live process leaves it writing to a deleted inode.

Shared helpers live in `scripts/common.sh`, so a fix to the `.env` backfill or
the path handling reaches all three scripts at once.

**Every command, every flag, and why each safeguard is there:**
[`docs/SCRIPTS.md`](docs/SCRIPTS.md).

### Prerequisites

| Tool | Needed for |
|---|---|
| **Python 3.11+** | The backend |
| **Node 20+** and **pnpm** | Frontend. `setup` enables pnpm via corepack if missing |
| **Ollama** *(optional)* | Model inference. The dashboard runs fine without it |
| **Docker** *(optional)* | Only for SearXNG web search. Nothing else uses it |

```bash
ollama serve
ollama pull qwen3:1.7b
```

---

## Configuration

Everything lives in **`.env`**, created from [`.env.example`](.env.example) by
`setup`. `daedalus.sh`, `sync.sh` and `reset.sh` all read it.

| Setting | Default | Controls |
|---|---|---|
| `DAEDALUS_PORT` | `8000` | Dashboard + API under `start` |
| `BACKEND_PORT` / `FRONTEND_PORT` | `8000` / `5173` | `dev` mode |
| `CHROMA_URL` | *(empty)* | Vector store. Empty = embedded in the API, in `data/chroma`; set it to use a separate Chroma server |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Model runtime |
| `SEARXNG_URL` | `http://127.0.0.1:8081` | Optional web search |

The five stores live in the repo, and the scripts set their paths themselves:

```
data/sqlite/sensor_readings.db   sensor telemetry (read-only)
logs/ai_logs.db                  audit logs
data/chroma/                     vector store
data/sqlite/chat.db              chat transcripts
backend/data/prefs.db            UI preferences
```

To point Daedalus at a **real reactor database**, put it at
`data/sqlite/sensor_readings.db` (or symlink it there). It is opened read-only
regardless.

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
| **Vector** | ChromaDB + SQLite | read/write | embedded manual, SOP, troubleshooting and safety chunks (Chroma), and the record of what was ingested — each document's category and **this rig / reference** origin (`corpus.db`) |
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
├── data/                Runtime: sensor DB, chat DB, documents, chroma  (gitignored)
├── logs/                Runtime: audit logs                     (gitignored)
├── backups/             Snapshots from `migrate backup`         (gitignored)
│
├── .env.example         Configuration template
├── daedalus.sh          Entry point — setup, dev, start, migrate
├── docker-compose.yml   The optional SearXNG container — nothing else
├── config/searxng/      Settings template for the optional search container
├── sync.sh              Get a checkout working after a pull (safe)
├── reset.sh             Wipe and rebuild the databases (destructive)
├── ACKNOWLEDGMENTS.md   What this project borrowed, and from whom
└── TODO.md              Roadmap
```

Frontend and backend are fully separated: the frontend is a pure client of the
API, and the backend has no knowledge of React. `start` proves it — the bundle
is built on its own and served as static files.

---

## Status

Zone 4 (the dashboard) and the data layer exist. The AI layer — the actual
research contribution — is the work ahead. Tracked in [`TODO.md`](TODO.md),
detailed in [`docs/FEATURES.md`](docs/FEATURES.md).

### Built

| Area | What works |
|---|---|
| **Dashboard** | React 19 · Vite 8 · TanStack Router · Tailwind v4 · shadcn/base-ui |
| **Chat interface** | Message list, composer, model selector, incognito — wired end to end. Replies stream token by token from a real local model, survive a reload mid-answer, and carry citation chips and a *Sources* list showing exactly which reading, passage or graph node backs each claim |
| **Chat history** | Real sidebar from `GET /api/sessions` — select, inline rename, delete, filter; transcripts reload on reopen |
| **Dynamic Models**| Unified `/api/system/models` querying Ollama + cloud baselines, with per-model capability badges (reasoning · tools · vision). Cloud models are selectable but marked, and their turns are logged apart |
| **Theme engine** | 16 themes · live editing of 7 base + 14 per-zone colours · derived syntax ramps · harmony generator · font/density/scale · frosted glass · import/export |
| **Typography** | **Monocraft** — the Minecraft typeface — as the default face, bundled and self-hosted; four alternatives in the Font selector |
| **Background effects** | 13 options, 11 canvas-animated — including Nexus, Aurora, Bubbles and Voxels. Cursor reactivity was built and then deliberately removed: on a monitoring console, the only thing moving for a reason should be the answer on screen |
| **Attention dimming** | The sidebar and the chat surfaces sit back translucent while the pointer and focus are elsewhere |
| **Floating windows** | Settings, Data stores, the Forge and the theme palette open as draggable, resizable windows with **Peek** (fade to see the page behind) and **minimize** (collapse to a chip beside the incognito toggle, restored exactly as you left it). Clicking outside minimizes rather than closes, so a stray click never discards what you were doing |
| **Window snapping** | Drag a window into an edge and it takes that region on release — halves, quadrants, or the whole screen from the top. The target is drawn as a dashed outline first, dragging a snapped window restores its old size under the cursor, and double-clicking the header maximizes |
| **Collapse animation** | One cascade for every collapsible thing: rows arrive from below with a small overshoot, staggered, and leave bottom-up without one. The exit waits on the real animations rather than a timeout, so a two-row section does not sit through a twelve-row section's timing |
| **Loading skeletons** | Placeholders shaped like the content they precede, in a pixel or smooth style — switchable in Theme → Customize |
| **Data stores** | Four browsable stores in the sidebar under the chats — chat · audit · sensor · vector. Expand one, click a table, read its rows in a floating window. Preferences is the fifth store and is deliberately absent: it holds this UI's own settings, not evidence |
| **Hardware detection** | RAM · CPU · GPU/VRAM · disk · Ollama. Probed on a background schedule, not on every panel open, and dormant when nobody is looking. Settings → Hardware, and **The Forge**. Reads the host directly, so the GPU it reports is the real card |
| **The Forge** | Hardware and model console. Estimates memory per model × quantization, scores fit against **both** memory pools (`safe` / `marginal` / `will_not_fit`, GPU / offload / CPU), pulls and deletes via Ollama, benchmarks on a RAG-sized prompt, and commits the choice to `config/model_config.json` Also where Track 1's re-rankers are downloaded and deleted. |
| **Model discovery** | 37 catalogue entries with every Ollama tag verified against the registry, live Hugging Face GGUF search, and a Custom tab that scores any tag you type. Sizes come from published manifests, so an estimate uses real bytes before anything is downloaded |
| **Model manager** | What is installed, badged SLM or LLM, with per-model usage: runs split by chat and benchmark, token totals, and latency as mean / p50 / p95 |
| **Chat** | `POST /api/chat` runs the whole pipeline: understand the question, refuse control requests, plan tools by rule, read sensors and the selected track's knowledge, build a labelled evidence pack, stream the answer, and replace it with a fallback if it states a number, time or cause the evidence does not. The committed model is always local; a cloud model answers only when explicitly picked, and that turn is logged apart |
| **Accessible theming** | Every colour derives from the selected theme and is floored to WCAG AA: body, muted, accent-as-text, on-accent labels and the three status colours. All 16 shipped themes pass on every role, and custom themes run through the same derivation |
| **Settings** | Registry-driven nav, keyword search, drag-resizable rail, layout persisted server-side. Every panel is built — Databases reports health only |
| **Keyboard shortcuts** | 11 rebindable actions across navigation, conversations and windows. Click a chord, press keys, Enter saves and Escape abandons — nothing commits on the first keypress. Duplicates are shown with the rule that resolves them, unbinding is Backspace, and AltGr is not mistaken for Ctrl+Alt |
| **Appearance** | Nine switches over the app's own furniture — sidebar brand, New, core modules, chat list, data stores, bottom bar; welcome message, incognito button, full-width transcript. Chrome only: nothing switchable can hide an answer, a citation or a refusal |
| **Web search** | Six providers (SearXNG · DuckDuckGo · Brave · Google PSE · Tavily · Serper) with an ordered fallback chain, per-provider credentials and a live probe. A **setup** surface for sourcing corpus documents — SearXNG ships as an optional Docker container tuned for technical literature |
| **Agent tools** | 33 tools in six categories behind a dispatcher that checks declared effects, the selected retrieval track and the arguments before the function is entered. Every call writes a `tool_logs` row. **Simple** mode (default) lets only the answering tools run; **Advanced** opens the rest under per-tool switches and capability locks |
| **Tool policy** | Two axes, deliberately separate: four capability locks (`network_egress` · `write` · `admin` · `execute_code`) that say what the machine may do while a result is recorded, and a per-tool switch that says which tools the model is offered. A switched-off tool leaves the schema list and is refused if asked for by name. Every parameter carries a working example, so a trial run is one click |
| **System maintenance** | Settings → System: a filterable viewer over the backend's own rotating log, a credential-free backup/restore, and a per-category Danger Zone with typed confirmation. The sensor database is absent from all three by rule |
| **Container control** | Settings → Search can start and stop the SearXNG container, when `DOCKER_SOCKET` is set. Off by default — the socket is a host-level privilege, and the agent's `bash` tool runs as the same user |
| **MCP** | Connect to external tool servers over stdio or HTTP. Each server's tool list is **pinned and hashed**, so a server that grows a tool is reported as drift and the new tool is refused — the protocol is designed to be dynamic, and §7.2 needs it not to be |
| **Backend** | FastAPI · health + system endpoints · preference store · flash-free first paint |
| **Conversation memory** | Session store, transcripts, rolling-summary and token-budgeted context assembly, incognito |
| **Data stores** | All five wired, health-reported, each with a versioned schema |
| **Migrations** | Numbered SQL files, applied in a transaction at startup, with drift and gap detection |
| **Deployment** | Single-image build + ChromaDB, one-command startup, and a dev overlay that runs the same image with hot reload |

### Retrieval

| | Status |
|---|---|
| **Knowledge ingestion** | Upload → extract → chunk → embed → Chroma, as one recorded run. Each document has a category (manual · SOP · troubleshooting/incident · safety (UAUC) · background) and an origin — **this rig** or **reference** (another installation), defaulting to reference |
| **Track 1 — vector RAG** | Top-k with category filtering and cross-encoder re-ranking |
| **Track 2 — graph RAG** | Embedding-free: entry by authored aliases, then either the **agent loop** (the local model picks each hop and decides when it has enough, under a hard time budget) or the **fixed walk** it is measured against |
| **Provenance** | Every passage and node is marked this rig or reference; an answer that rests only on a reference for a rig-specific fact must say so |

### Not built yet

- **The real knowledge.** No documents are ingested and the graph is placeholder data.
- **Evaluation** — the query set, ground truth, scoring, and the three comparison runs (Track 1 · Track 2 walk · Track 2 agent).
- Track 1's hybrid search, query expansion, compression and multi-hop re-retrieval.
- Ariadne's Thread, the provenance viewer.

---

## How it works

```
User question
     ↓
FastAPI  ── normalise → classify intent → SAFETY GUARD
     ↓
     ├─ live/trend          → deterministic SQL tools ─→ SQLite (read-only)
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
| **Shape** | One retrieval → one generation | Agent loop: the model picks each hop and judges when it has enough — or a fixed walk, as the within-track baseline |
| **Strength** | Fast, simple, strong single-hop | Explicit relationships, genuine multi-hop |
| **Cost** | Weak on multi-hop | Higher latency, silent gaps when a relation was never authored |

Measured on groundedness, retrieval precision/recall, latency (mean + p95),
multi-hop success and refusal correctness — over three runs of the same
questions: Track 1, Track 2's fixed walk, and Track 2's agent loop. Only the
selected track answers any question; the comparison is between runs.

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

Two processes on your machine: `uvicorn --reload` watching `backend/app` on
:8000, and Vite on :5173 proxying `/api` across. Saving a file reloads the
backend in place; the UI hot-reloads. Ctrl-C stops both. A debugger attaches to
either in one step.

```bash
# Or drive the two yourself (host_uvicorn sets the data paths — see docs/SCRIPTS.md)
. ./scripts/common.sh && host_uvicorn app.main:app --reload --port 8000 --app-dir backend
cd frontend && pnpm dev
```

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
**Ops** — runs on the host: one uvicorn process, embedded ChromaDB · Docker only for optional SearXNG

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
