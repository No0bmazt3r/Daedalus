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

1. **Fully local.** No cloud APIs in the runtime. Cloud models appear only as
   offline evaluation baselines.
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

`setup` is safe to re-run. It never overwrites your `.env` and never touches a
database that already has data — re-running just tops up any settings added to
`.env.example` since.

### Commands

| Command | Does |
|---|---|
| `./daedalus.sh setup` | One-time: verify prerequisites, install deps, create `.env`, make runtime dirs |
| `./daedalus.sh start` | Build (if needed) and start the container stack |
| `./daedalus.sh dev` | Hot-reload dev servers instead, no Docker. Ctrl-C stops both |
| `./daedalus.sh stop` | Stop the stack |
| `./daedalus.sh logs` | Follow logs |
| `./daedalus.sh rebuild` | Force a clean image rebuild, then start |
| `./daedalus.sh status` | What's running, plus health of all four databases |

Add `--with-ollama` to `start` to run Ollama as a container instead of on the host.

### Prerequisites

| Tool | Needed for |
|---|---|
| **Docker** | The container stack. `setup` checks the daemon is reachable |
| **Node 20+** and **pnpm** | Frontend. `setup` enables pnpm via corepack if missing |
| **Python 3.11+** | Backend virtualenv for `dev` mode |
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

## The four databases

Separate on purpose: a fault in ingestion or logging physically cannot reach the
sensor data of record. **Settings → Databases** shows all four live, and
`./daedalus.sh status` prints the same from the terminal.

| Store | Engine | Access | Holds |
|---|---|---|---|
| **Sensor** | SQLite | **read-only** | IoT telemetry written by the SCADA subsystem |
| **Audit** | SQLite | read/write | chat · tool-call · retrieval · model · error · feedback · memory logs |
| **Vector** | ChromaDB | read/write | embedded SOP/manual/anomaly chunks for RAG |
| **Prefs** | SQLite | read/write | UI state, kept out of the browser |

The read-only boundary is the SQLite driver's, not a convention:

```python
conn = sqlite3.connect(f"file:{SENSOR_DB}?mode=ro", uri=True)
```

INSERT, UPDATE, DELETE and DROP all raise; reads keep working. A prompt
injection cannot reach below that line.

**No telemetry yet?** Settings → Databases → *Generate demo data* seeds a
plausible run offline. It refuses if data already exists.

---

## Repository layout

```
├── frontend/            React dashboard (Zone 4)
│   ├── src/
│   │   ├── components/  Chat, theme modal, settings
│   │   ├── contexts/    Theme + settings state
│   │   ├── hooks/       Draggable, resizable sidebar
│   │   └── lib/         Theme engine, canvas effects, API clients
│   ├── public/
│   └── package.json     …and the rest of the Vite/TS toolchain
│
├── backend/             FastAPI service (Zone 3)
│   ├── app/
│   │   ├── api/         Route handlers
│   │   └── db/          The four stores
│   └── requirements.txt
│
├── docs/                All documentation
│   ├── README.md        Index — start here
│   ├── PROJECT.md       Canonical specification
│   ├── FEATURES.md      What's actually built
│   ├── research/        FYP1 research specs    ─┐ historical,
│   └── architecture/    11-layer design specs  ─┘ superseded by PROJECT.md
│
├── data/                Runtime: sensor DB, documents  (gitignored)
├── logs/                Runtime: audit logs            (gitignored)
│
├── .env.example         Configuration template
├── Dockerfile           Multi-stage: builds frontend, served by backend
├── docker-compose.yml   App + ChromaDB (+ optional Ollama)
├── daedalus.sh          Entry point
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
| **Chat interface** | Message list, composer, model selector, incognito mode *(UI only — no backend wired yet)* |
| **Theme engine** | 16 themes · live editing of 7 base + 14 per-zone colours · derived syntax ramps · harmony generator · font/density/scale · frosted glass · import/export |
| **Background effects** | 9 options, 7 canvas-animated, **pointer-reactive** |
| **Settings** | Registry-driven nav, keyword search, drag-resizable rail, layout persisted server-side |
| **Backend** | FastAPI · health + system endpoints · preference store · flash-free first paint |
| **Data stores** | All four wired, containerised and health-reported |
| **Deployment** | Single-image build + ChromaDB, one-command startup |

### Not built yet

Knowledge ingestion, both retrieval tracks, the deterministic tool layer, the
orchestration flow, Ollama integration and the evaluation harness. The stores
exist and report health; nothing reads or writes them in anger yet.

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

Runs uvicorn with `--reload` on :8000 and Vite on :5173 proxying `/api` to it.
Ctrl-C stops both.

<details>
<summary>Driving the two servers yourself</summary>

```bash
# Terminal 1 — backend
backend/.venv/bin/uvicorn app.main:app --reload --port 8000 --app-dir backend

# Terminal 2 — frontend
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

## License

See [`LICENSE`](LICENSE).
