<div align="center">

# Daedalus

**A 100% local, read-only conversational AI layer for real-time CO₂ sorption reactor monitoring.**

Ask a reactor plain-language questions. Get grounded, cited answers.
No cloud. No hallucinated sensor values. No write path to the plant.

</div>

---

## What it is

[CO2SorptionDT](#) is an existing PyQt5 SCADA application monitoring a lab-scale
CO₂ sorption reactor, logging temperature, pressure, pH, level and NDIR CO₂
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
   sensors — enforced by the driver and the tool registry, not by prompting.
   The automated ball valves are write-only from SCADA, so their true state
   can't be verified downstream; a hallucinated write could move real hardware.
   Removing the capability entirely eliminates the risk class.
3. **The model never invents numbers.** Every value is fetched by a
   deterministic tool. The LLM only phrases what was retrieved — and says
   "I don't have that information" when nothing was.

---

## Quick start

```bash
git clone <repo> && cd Daedalus
./run.sh
```

That's it — one container serving the dashboard and the API on
**<http://localhost:8000>**.

<details>
<summary>Other ways to run it</summary>

```bash
./run.sh --rebuild        # force a clean image rebuild
./run.sh --with-ollama    # run Ollama in a container too
./run.sh --logs           # follow logs
./run.sh --down           # stop everything

docker compose up         # equivalent to ./run.sh
```

**Ollama runs on the host by default** — GPU passthrough is simpler and the
model cache survives rebuilds. Install it from [ollama.com](https://ollama.com),
then:

```bash
ollama serve
ollama pull qwen3:1.7b
```

</details>

<details>
<summary>Local development (hot reload)</summary>

Two processes, Vite proxying <code>/api</code> to FastAPI:

```bash
# Terminal 1 — backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
pnpm install
pnpm dev          # → http://localhost:5173
```

</details>

---

## Status

Zone 4 (the dashboard) and a thin Zone 3 shell exist. The AI layer — the actual
research contribution — is the work ahead. Tracked in **[`TODO.md`](TODO.md)**.

### Built

| Area | What works |
|---|---|
| **Dashboard** | React 19 · Vite 8 · TanStack Router · Tailwind v4 · shadcn/base-ui |
| **Chat interface** | Message list, auto-growing composer, model selector, incognito mode *(UI only — no backend wired yet)* |
| **Theme engine** | 16 themes · live editing of 7 base + 14 per-zone colours · derived syntax ramps · complementary-harmony generator · font/density/text-scale · frosted glass · import/export · 8 saved custom themes |
| **Background effects** | 9 options, 7 canvas-animated, with colour/intensity/size and **pointer-reactive** behaviour |
| **Settings** | Registry-driven navigation, keyword search (type "vram", get Hardware), drag-resizable + collapsible rail, layout persisted server-side |
| **Backend** | FastAPI skeleton · health + system endpoints · flash-free first paint via a server-rendered `theme.css` |
| **Data stores** | Four separate databases wired and containerised — see below |
| **Deployment** | Single-image Docker build + ChromaDB service, one-command startup |

Preferences are stored **server-side in SQLite — deliberately nothing in browser
storage**, so the same account carries its setup across machines.

### The four databases

Separate on purpose — a fault in ingestion or logging physically cannot reach
the sensor data of record. Settings → Databases shows all four live.

| Store | Engine | Access | Holds |
|---|---|---|---|
| **Sensor** | SQLite | **read-only** | IoT telemetry written by the SCADA subsystem |
| **Audit** | SQLite | read/write | chat · tool-call · retrieval · model · error · feedback · memory logs |
| **Vector** | ChromaDB | read/write | embedded SOP/manual/anomaly chunks for RAG |
| **Prefs** | SQLite | read/write | UI state, kept out of the browser |

The read-only boundary is enforced by the SQLite driver (`mode=ro`), not by
convention: INSERT, UPDATE, DELETE and DROP all raise, while reads keep working.

No telemetry yet? **Settings → Databases → Generate demo data** seeds a
plausible run offline (it refuses if data already exists).

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

Both containerised services keep their state on host volumes: `./data`
(sensor DB, vector/graph stores, documents), `./logs` (audit logs),
`backend/data` (UI preferences).

---

## Repository layout

```
├── src/                 React dashboard (Zone 4)
│   ├── components/      Chat, theme modal, settings
│   ├── contexts/        Theme + settings state
│   └── lib/             Theme engine, canvas effects, API clients
├── backend/             FastAPI service (Zone 3)
│   └── app/
│       ├── api/         Route handlers
│       └── db/          SQLite stores
├── docs/                ★ All documentation, one folder
│   ├── README.md        Index — start here
│   ├── PROJECT.md       Canonical specification
│   ├── FEATURES.md      What's actually built
│   ├── research/        FYP1 research specs    ─┐ historical,
│   └── architecture/    11-layer design specs  ─┘ superseded by PROJECT.md
├── TODO.md              Roadmap and progress
└── run.sh               One-command startup
```

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
