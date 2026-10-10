<div align="center">

# Daedalus

**A 100% local, read-only chat assistant for real-time CO₂ sorption reactor monitoring.**

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

Daedalus is a **standalone chat application** that reads that stack's data —
never replacing or controlling it — so anyone can ask:

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
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Model runtime |
| `SEARXNG_URL` | `http://127.0.0.1:8081` | Optional web search |

The five stores live in the repo, and the scripts set their paths themselves:

```
data/sqlite/sensor_readings.db   sensor telemetry (read-only)
logs/ai_logs.db                  audit logs
data/chroma/                     vector store (embedded in the API)
data/sqlite/corpus.db            what was ingested, and the graph's edit history
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
sensor data of record. **Settings → System → Storage Health** shows all five live, and
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

**No telemetry yet?** Settings → System → Storage Health → *Generate demo data* seeds a
plausible run offline. It refuses if data already exists.

---

## Repository layout

```
├── frontend/            React dashboard (Zone 4)
│   ├── src/
│   │   ├── components/  Chat, Forge, Blueprints, Thread, settings, error pages
│   │   ├── contexts/    Theme, settings and conversation state
│   │   ├── hooks/       Windows, sizing, live refresh, shortcuts
│   │   └── lib/         Theme engine, one typed API client per backend area
│   ├── tests/           Node's own test runner — pure logic only
│   └── package.json     …and the rest of the Vite/TS toolchain
│
├── backend/             FastAPI service (Zone 3)
│   ├── app/
│   │   ├── api/         Route handlers — HTTP only
│   │   ├── services/    Chat pipeline, tools, retrieval, Forge, evaluation
│   │   ├── models/      Pydantic wire contracts
│   │   ├── db/          The five stores, and schema migrations
│   │   ├── data/        Shipped catalogues and the graph seed
│   │   └── cli_eval.py  The evaluation harness
│   ├── tests/           Stdlib unittest, grouped by area
│   └── requirements.txt
│
├── config/              Committed choices: model, retrieval track, embedder,
│                        the authored graph, the evaluation query set
├── docs/                All documentation — start at docs/README.md
│   ├── PROJECT.md       Canonical specification
│   ├── FEATURES.md      What's actually built
│   ├── STATUS.md        Plain-language progress
│   └── REPORT_NOTES.md  Material for the FYP2 report
│
├── scripts/
│   └── common.sh        Shared shell helpers for the three scripts below
│
├── data/                Runtime: sensor, chat and corpus DBs, chroma   (gitignored)
│   └── corpus_sources/  Documents collected for the corpus, with their sources
├── logs/                Runtime: audit logs                     (gitignored)
├── backups/             Snapshots from `migrate backup`         (gitignored)
│
├── .env.example         Configuration template
├── daedalus.sh          Entry point — setup, dev, start, migrate
├── docker-compose.yml   The optional SearXNG container — nothing else
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

The software is built end to end; the research result is not. Both retrieval
tracks answer, every answer is traceable, and the evaluation harness is ready —
but the knowledge is still mostly placeholder and nothing has been evaluated.
Plain-language progress: [`docs/STATUS.md`](docs/STATUS.md). Item by item:
[`TODO.md`](TODO.md). In depth: [`docs/FEATURES.md`](docs/FEATURES.md).

### Built

| Area | What works |
|---|---|
| **Chat** | `POST /api/chat` runs the whole pipeline: understand the question, refuse control requests, plan tools by rule, read sensors and the selected track's knowledge, build a labelled evidence pack, stream the answer, and replace it with a fallback if it states a number, time or cause the evidence does not. Answers render as Markdown with citation chips and a *Sources* list. The committed model is always local; a cloud model answers only when explicitly picked, and that turn is logged apart |
| **Chat history** | Real sidebar from `GET /api/sessions` — select, inline rename, delete, filter; transcripts reload on reopen; replies survive a reload mid-answer |
| **Conversation memory** | Session store, transcripts, rolling summary and token-budgeted context assembly, incognito |
| **Ariadne's Thread** | Every chat turn as ordered steps — question, intent, tools, retrieval, evidence, model, validation, answer — with every number in the answer checked against the evidence, a human label for evaluation, and Markdown export |
| **Labyrinth Blueprints** | Track 1: build the corpus (upload → extract → chunk → embed, as recorded runs), browse it, replay a retrieval, read ingest logs. Track 2: author the graph by hand or review a local model's proposals, see it as a diagram, find coverage gaps, replay a walk hop by hop |
| **The Forge** | Hardware and model console. Detects the machine, estimates memory per model × quantization, scores fit against **both** memory pools (`safe` / `marginal` / `will_not_fit`), pulls and deletes via Ollama, benchmarks on a RAG-sized prompt, and commits the choice — for chat models, embedding models and Track 1's re-rankers |
| **Model discovery** | 37 catalogue entries with every Ollama tag verified against the registry, 16 embedding models, live Hugging Face GGUF search, and a Custom tab that scores any tag you type |
| **Agent tools** | 33 tools in six categories behind a dispatcher that checks declared effects, the selected retrieval track and the arguments before the function is entered. Every call writes a `tool_logs` row. **Simple** mode (default) lets only the answering tools run; **Advanced** opens the rest under per-tool switches and capability locks |
| **Tool policy** | Two axes, deliberately separate: four capability locks (`network_egress` · `write` · `admin` · `execute_code`) and a per-tool switch. A switched-off tool leaves the schema list and is refused if asked for by name |
| **Evaluation harness** | `python -m app.cli_eval` asks the query set once per arm (Track 1 · Track 2 walk · Track 2 agent) through the real chat path, scores it, and refuses an official run unless the comparison is frozen |
| **Data stores** | All five wired, health-reported, each with a versioned schema; chat, audit, sensor, corpus and vector browsable from the sidebar (prefs deliberately not) |
| **Migrations** | Numbered SQL files, applied in a transaction at startup, with drift and gap detection |
| **Error pages** | A tab or window that cannot load becomes a themed, animated error page; a failed action shows its reason and a server error id |
| **Web search** | Six providers with an ordered fallback chain — a **setup** surface for sourcing corpus documents. SearXNG ships as an optional container tuned for technical literature, and Settings → Search can start it when `DOCKER_SOCKET` is set |
| **MCP** | Connect to external tool servers over stdio or HTTP. Each server's tool list is **pinned and hashed**, so a server that grows a tool is reported as drift and the new tool is refused |
| **System maintenance** | Settings → System: storage health, a filterable process log, a credential-free backup/restore, and a per-category Danger Zone with typed confirmation. The sensor database is absent from all of them by rule |
| **Dashboard** | React 19 · Vite 8 · TanStack Router · Tailwind v4 · shadcn/base-ui. Floating windows with Peek, minimize and edge snapping; command palette; 11 rebindable shortcuts; registry-driven, searchable Settings |
| **Theming** | 16 themes, live per-zone colours, import/export, all floored to WCAG AA on every text role; Monocraft as the default face; 13 background effects; pixel or smooth loading skeletons |
| **Deployment** | Runs on the host — one uvicorn process with embedded Chroma — via `./daedalus.sh`; `sync.sh` after a pull, `reset.sh` to rebuild |
| **Tests** | 231 backend `unittest` cases and 9 frontend logic tests |

### Retrieval

| | Status |
|---|---|
| **Knowledge ingestion** | Each document has a category (manual · SOP · troubleshooting/incident · safety (UAUC) · background) and an origin — **this rig** or **reference** (another installation), defaulting to reference. PDFs include AES-locked and font-shifted manuals |
| **Track 1 — vector RAG** | Top-k with category filtering and cross-encoder re-ranking — a plain baseline by decision |
| **Track 2 — graph RAG** | Embedding-free: entry by authored aliases, then either the **agent loop** (the local model picks each hop and decides when it has enough, under a hard time budget) or the **fixed walk** it is measured against |
| **Provenance** | Every passage and node is marked this rig or reference; an answer that rests only on a reference for a rig-specific fact must say so |

### Not done yet

- **The real knowledge.** 2 reference documents are ingested (162 chunks); the
  lab's own documents are still needed, and the graph is placeholder data.
- **Evaluation** — the 30–50 question set and its labels, and the three
  comparison runs.
- **Model choice** — the small-model tier is untested and the lab machine's
  specs are unconfirmed.

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
Zone 3  Daedalus ─ FastAPI · tools · RAG · Ollama       ← this project
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
pnpm lint           # oxlint
pnpm test           # logic tests (Node's own runner)
pnpm build          # production build

cd ../backend
.venv/bin/python -m unittest discover -s tests -t .   # -t . is required
```

Tests are not in CI; run them before a commit.

</details>

---

## Tech stack

**Frontend** — React 19 · TypeScript · Vite 8 · TanStack Router · Tailwind v4 · shadcn/base-ui · Lucide
**Backend** — FastAPI · Pydantic · SQLite (WAL) · Uvicorn · pypdf
**AI** — Ollama (candidates: Qwen3 1.7B · Phi-3 Mini · Gemma 3 1B, Q4_K_M) · ChromaDB · NetworkX · a local embedding model chosen per machine · ONNX cross-encoder re-rankers
**Ops** — runs on the host: one uvicorn process, embedded ChromaDB · Docker only for optional SearXNG

---

## Scope

**Out of scope, deliberately:** cloud LLMs in production · any write path to the
plant · cybersecurity/IIoT hardening · automated chart generation (existing SCADA
covers it) · physical hardware changes · auth/multi-tenancy · fine-tuning.

**Deferred to Phase 2:** the PyQt5 embedded tab · the vector-DB bake-off ·
multi-device support · Kùzu backend · multi-lab LAN deployment.

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

Full attribution, including the rest of the stack:
[`ACKNOWLEDGMENTS.md`](ACKNOWLEDGMENTS.md).

---

## License

See [`LICENSE`](LICENSE).
