<div align="center">

<img src=".github/readme/banner.svg" alt="Daedalus terminal banner: a labyrinth with Ariadne's thread, the word DAEDALUS, and boot checks — read-only sensor db, local Ollama model, two retrieval tracks, 33 deterministic tools" width="860">

**A local-first, read-only chat assistant for a lab-scale CO₂ sorption reactor.**

<a href="#run-it"><img src="https://img.shields.io/badge/runs-local_by_default-7aa9e8?style=for-the-badge&labelColor=161b22" alt="runs: local by default"></a>
<a href="#tests"><img src="https://img.shields.io/badge/tests-265_passing-3fb950?style=for-the-badge&labelColor=161b22" alt="tests: 265 passing"></a>
<a href="#license"><img src="https://img.shields.io/badge/license-MIT-d2a8ff?style=for-the-badge&labelColor=161b22" alt="license: MIT"></a>

<sub><samp>built with</samp></sub><br>
<img src="https://img.shields.io/badge/Ollama-000000?style=flat-square&logo=ollama&logoColor=white" alt="Ollama">
<img src="https://img.shields.io/badge/Hugging_Face-FFD21E?style=flat-square&logo=huggingface&logoColor=black" alt="Hugging Face">
<img src="https://img.shields.io/badge/ChromaDB-FF6446?style=flat-square" alt="ChromaDB">
<img src="https://img.shields.io/badge/NetworkX-2C5BB4?style=flat-square" alt="NetworkX">
<img src="https://img.shields.io/badge/ONNX_Runtime-005CED?style=flat-square&logo=onnx&logoColor=white" alt="ONNX Runtime"><br>
<img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python">
<img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI">
<img src="https://img.shields.io/badge/Pydantic-E92063?style=flat-square&logo=pydantic&logoColor=white" alt="Pydantic">
<img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
<img src="https://img.shields.io/badge/Uvicorn-499848?style=flat-square" alt="Uvicorn"><br>
<img src="https://img.shields.io/badge/React_19-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React 19">
<img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
<img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite">
<img src="https://img.shields.io/badge/TanStack_Router-FF4154?style=flat-square&logo=reactquery&logoColor=white" alt="TanStack Router">
<img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS">
<img src="https://img.shields.io/badge/pnpm-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm">

</div>

```text
you@daedalus:~$ cat ./about
ask a reactor plain-language questions. get answers traceable to the exact
database row, document page or graph node they came from. local by
default, no invented sensor values, no write path to the plant.

you@daedalus:~$ cat ./status
software: built end to end.   evaluation: harness ready, not yet run.
lab's own documents: tbc — not yet received.
```

**Final Year Project** — BCS (Hons), Universiti Teknologi PETRONAS.
Full specification: [`docs/PROJECT.md`](docs/PROJECT.md) · all docs: [`docs/`](docs/README.md)

---

## What it is

CO2SorptionDT is an existing PyQt5 SCADA app that logs temperature, pressure,
pH, level and NDIR CO₂ from a lab reactor to SQLite every 5 seconds. Reading
it today means raw graphs, SCADA jargon, and cross-referencing SOPs by hand.

Daedalus is a **standalone chat app** that reads that data — never replacing
or controlling it — so an operator can ask:

> *"Is the reactor running fine right now?"*
> *"Why did the CO₂ reading spike at 10:00?"*
> *"What do I do if the NDIR reading drifts?"*

```
User question
     ↓
FastAPI ── normalise → classify intent → SAFETY GUARD
     ↓
     ├─ live / trend          → deterministic SQL tools ─→ SQLite (read-only)
     └─ SOP / troubleshooting → Track 1 vector RAG     ─→ ChromaDB
                                Track 2 agentic GraphRAG ─→ knowledge graph
     ↓
Evidence pack → Ollama (local SLM) → response validator
     ↓
Answer + citations + full tool trace
```

## Why

- **Local by default.** Out of the box every answer comes from a model on
  your machine via Ollama. Cloud models are supported as an opt-in
  comparison baseline: none is set up initially, you add one in
  **The Forge → Installed → Cloud endpoints**, it answers only the turn you
  pick it for, and that turn is logged `chat_cloud` and kept out of every
  latency figure.
- **Read-only toward the plant — enforced, not prompted.** The sensor DB is
  opened `mode=ro` by the SQLite driver; `INSERT`/`UPDATE`/`DELETE` raise.
  A control request like *"open valve ABV-1"* is refused at the safety guard,
  before any tool runs and without an LLM call.
- **The model never invents numbers.** 33 deterministic tools fetch every
  value; the LLM only phrases it. An answer stating a number, time or cause
  the evidence does not contain is replaced with a fallback.
- **Every answer is auditable.** *Ariadne's Thread* replays each turn step by
  step — intent, tools, retrieval, evidence, model, validation — with every
  number in the answer checked against the evidence.

## The research question

Two retrieval architectures, same query set, same model — so the
*architecture* is the only variable:

| | Track 1 — vector RAG | Track 2 — agentic GraphRAG |
|:--|:--|:--|
| **Retrieval** | Top-k similarity + cross-encoder re-rank | Multi-hop traversal, embedding-free entry by alias |
| **Store** | ChromaDB | NetworkX (62-node authored graph) |
| **Shape** | One retrieval → one generation | Model picks each hop under a time budget, vs a fixed walk |
| **Expected cost** | Weak on multi-hop | Higher latency; silent gaps where a relation was never authored |

Scored on groundedness, retrieval precision/recall, latency (mean + p95),
multi-hop success and refusal correctness.
**Targets:** < 3 s end-to-end · > 80 % retrieval precision · < 10 % hallucination.

> Vector RAG matching GraphRAG at a fraction of the latency would be a valid —
> arguably more interesting — result. The experiment is built to find out.

How a run works: [`docs/EVALUATION.md`](docs/EVALUATION.md).

### Measured so far

Latency on the dev machine (RTX 3050 Laptop, 4 GB VRAM), `qwen3:1.7b`.
The benchmark uses a RAG-sized prompt because a bare question flatters TTFT:

| prompt | TTFT | prefill |
|:--|--:|--:|
| 91 tokens (bare question) | 3,399 ms | 152 ms |
| 2,321 tokens (evidence pack) | 1,123 ms | 890 ms |

Method and caveats: [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

## Features

| | |
|:--|:--|
| **Chat** | Streamed, Markdown answers with citation chips and a *Sources* list; history, rename, incognito, rolling summary |
| **Ariadne's Thread** | Per-turn trace of every step, human labels for evaluation, Markdown export |
| **Labyrinth Blueprints** | Track 1: upload → extract → chunk → embed, browse, replay a retrieval. Track 2: author or review the graph, see it as a diagram, replay a walk hop by hop |
| **The Forge** | Detects the machine, scores model fit (`safe` / `marginal` / `will_not_fit`), pulls models via Ollama, benchmarks, commits the choice |
| **Tool policy** | Four capability locks (`network_egress` · `write` · `admin` · `execute_code`) plus per-tool switches |
| **MCP** | External tool servers over stdio/HTTP; each tool list is pinned and hashed, so drift is refused |
| **Dashboard** | Floating windows, command palette, 16 themes floored to WCAG AA |

Everything that is built, in detail: [`docs/FEATURES.md`](docs/FEATURES.md).

## Screenshots

<table>
  <tr>
    <th width="50%">Chat</th>
    <th width="50%">Ariadne's Thread</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/01-chat.png" alt="Chat answering a reactor question, with citation chips and a Sources list"><br><sub><samp>grounded answer with citation chips</samp></sub></td>
    <td align="center"><img src="docs/screenshots/20-thread.png" alt="Ariadne's Thread showing one turn's intent, tools, retrieval, evidence and validation"><br><sub><samp>every step of one turn, every number checked</samp></sub></td>
  </tr>
  <tr>
    <th width="50%">The Forge · Hardware</th>
    <th width="50%">The Forge · Benchmark</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/07-forge-hardware.png" alt="The Forge hardware tab showing the detected CPU, RAM and GPU"><br><sub><samp>this machine's memory pools, scored for fit</samp></sub></td>
    <td align="center"><img src="docs/screenshots/09-benchmark.png" alt="A finished Forge benchmark with time-to-first-token and throughput"><br><sub><samp>TTFT on a ~2k-token RAG prompt</samp></sub></td>
  </tr>
  <tr>
    <th width="50%">Labyrinth Blueprints</th>
    <th width="50%">Storage Health</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/14-graph.png" alt="Labyrinth Blueprints showing the Track 2 knowledge graph as a diagram"><br><sub><samp>the 62-node knowledge graph</samp></sub></td>
    <td align="center"><img src="docs/screenshots/03-databases.png" alt="Storage Health panel listing all five databases, sensor marked read-only"><br><sub><samp>five stores, sensor read-only</samp></sub></td>
  </tr>
</table>

## Run it

**Requirements:** Python 3.11+, Node 20+ with pnpm. Ollama is optional (the
dashboard runs without it); Docker is only for optional SearXNG web search.

```bash
git clone <repo> && cd Daedalus
./daedalus.sh setup        # one-time: checks tools, installs deps, creates .env
./daedalus.sh dev          # hot reload: API on :8000, UI on http://localhost:5173
```

Pull a model so it can answer:

```bash
ollama serve
ollama pull qwen3:1.7b
```

No telemetry yet? **Settings → System → Storage Health → Generate demo data**
seeds a plausible run offline.

| Command | Does |
|:--|:--|
| `./daedalus.sh start` | Build the UI once and serve it with the API on one port (:8000) |
| `./daedalus.sh status` | Health of all five databases |
| `./daedalus.sh migrate` | Apply pending schema migrations |
| `./daedalus.sh dev --with-search` | Also run SearXNG for sourcing corpus documents |
| `./sync.sh` | After a `git pull`: deps, `.env` backfill, migrations — safe to re-run |
| `./reset.sh` | Wipe and rebuild chat, audit and prefs DBs — **destructive**, snapshots first |

Every command, flag and safeguard: [`docs/SCRIPTS.md`](docs/SCRIPTS.md).

### Configuration

Everything lives in `.env`, created from [`.env.example`](.env.example) by
`setup`. It holds no secrets — nothing calls a cloud API until you add a
cloud endpoint in The Forge.

| Setting | Default |
|:--|:--|
| `BACKEND_PORT` / `FRONTEND_PORT` | `8000` / `5173` |
| `DAEDALUS_PORT` | `8000` (under `start`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` |
| `SEARXNG_URL` | `http://127.0.0.1:8081` |

To point Daedalus at a **real reactor database**, put it (or a symlink) at
`data/sqlite/sensor_readings.db`. It is opened read-only regardless.

## Architecture

```text
Zone 1  physical reactor    sensors, ABV valves                 pre-existing
Zone 2  SCADA acquisition   CO2SorptionDT → SQLite              pre-existing
          │ read-only  ◄── the safety boundary
Zone 3  Daedalus            FastAPI · tools · RAG · Ollama      this project
Zone 4  presentation        React dashboard                     this project
```

Five separate stores, so a fault in ingestion or logging physically cannot
reach the sensor data of record:

| Store | Access | Holds |
|:--|:--|:--|
| **Sensor** `data/sqlite/sensor_readings.db` | **read-only** | Telemetry written by SCADA |
| **Audit** `logs/ai_logs.db` | append | Chat, tool, retrieval, model and error logs |
| **Chat** `data/sqlite/chat.db` | read/write | Transcripts — the user may delete these |
| **Vector** `data/chroma/` + `corpus.db` | read/write | Embedded chunks and what was ingested |
| **Prefs** `backend/data/prefs.db` | read/write | UI state |

Each writable store has numbered SQL migrations applied at startup.
Which files make up each feature: [`docs/CODE_MAP.md`](docs/CODE_MAP.md).

**Stack** — React 19 · TypeScript · Vite 8 · TanStack Router · Tailwind v4 ·
FastAPI · Pydantic · SQLite (WAL) · ChromaDB · NetworkX · Ollama · ONNX
cross-encoder re-rankers.

## Tests

```bash
(cd backend  && .venv/bin/python -m unittest discover -s tests -t .)   # 252 tests
(cd frontend && pnpm test)                                            # 13 tests
(cd frontend && npx tsc -b && pnpm lint)                              # typecheck + lint
```

Not in CI — run before a commit.

## Project layout

```text
frontend/      React dashboard — components, contexts, hooks, typed API client
backend/       FastAPI service — api/, services/, models/, db/, cli_eval.py
config/        committed choices: model, retrieval track, graph, eval query set
docs/          all documentation — start at docs/README.md
scripts/       shared shell helpers
data/ logs/    runtime databases (gitignored)
daedalus.sh    entry point — setup, dev, start, status, migrate
sync.sh        get a checkout working after a pull (safe)
reset.sh       wipe and rebuild the databases (destructive)
```

## Status

The software is built; the research result is not.

- **Corpus:** 17 collected documents ingested (887 chunks). **The lab's own
  documents are TBC** — not yet received.
- **Graph:** 62 nodes, authored from reference procedures; sensor data is demo.
- **Evaluation:** harness built and tested; the 30–50 question set and the
  three comparison runs are not done.

Plain-language progress: [`docs/STATUS.md`](docs/STATUS.md) · item by item: [`TODO.md`](TODO.md)

**Out of scope, deliberately:** cloud LLMs in production · any write path to
the plant · anomaly detection · auth/multi-tenancy · fine-tuning.

## Credits

The dashboard's theme engine, settings shell and prefs API were modelled on
**[Odysseus](https://github.com/odysseus-dev/odysseus)** by Felix Kjellberg and
contributors. Daedalus is **not a fork**: no Odysseus source is in this repo,
and the React code was written from scratch. Full attribution:
[`ACKNOWLEDGMENTS.md`](ACKNOWLEDGMENTS.md).

## License

[MIT](LICENSE) © 2026 Sharvin A/L Kanesan

## Star history

<a href="https://star-history.com/#No0bmazt3r/Daedalus&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=No0bmazt3r/Daedalus&type=Date&theme=dark">
    <img src="https://api.star-history.com/svg?repos=No0bmazt3r/Daedalus&type=Date" alt="Star history chart for No0bmazt3r/Daedalus" width="600">
  </picture>
</a>

<sub>Banner generated by <code>python3 .github/readme/build.py</code>.</sub>
