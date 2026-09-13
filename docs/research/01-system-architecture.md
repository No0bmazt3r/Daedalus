# System Architecture

## 1. The 4-zone model (existing, from the interim report)

```
Zone 1                Zone 2                  Zone 3 (MY WORK)                    Zone 4
Physical Layer   →    Edge & Data Handoff →   AI SCADA System (Read-Only)   →     Presentation
(Reactor)              (Basic SCADA)                                              Layer

CO2 Sorption           SCADA System            FastAPI Backend (localhost)         PyQt Submodule
Column                 (existing PyQt5)         ├── Local SLM via Ollama
 - Temp                     ↓                   │   (Qwen3 / Phi-3 / Llama 3.1)     Conversational
 - pH                  Local SQLite DB  ------→  ├── Agent Tools (read-only)         UI Chatbox
 - Pressure                                      ├── Traditional RAG Engine
 - Level                                         │   (ChromaDB vector store)
 - NDIR CO2                                      └── Agentic GraphRAG Engine
                                                      (Graph DB + agent loop)
                                                          ↕
                                                  Local Vector/Graph DB
                                                  (RAG: Manuals, SOPs, UAUC)
```

**Zone 3 is the entirety of this project's contribution.** Zones 1, 2, and 4 already exist or are owned by teammates (Jason: IoT ingestion; Anson: anomaly detection).

## 2. The safety boundary (non-negotiable)

Zone 3 has **read-only** access to the SQLite database and read/write access only to its *own* vector/graph store (which contains no reactor control data — only documents and cached embeddings).

Why this matters: the automated ball valves (ABVs) are a **write-only path** from the existing SCADA layer — no downstream system, including this AI layer, can verify what state they're actually in. If the conversational agent could write anything back toward Zone 1/Zone 2, an accidental or hallucinated write could physically actuate hardware. Making Zone 3 strictly read-only eliminates this risk category entirely, by construction, rather than relying on prompt-level guardrails.

**Implementation-level enforcement (not just policy):**
- The SQLite connection used by the FastAPI backend is opened in read-only mode (`sqlite3.connect(..., uri=True)` with `?mode=ro`, or equivalent).
- No tool exposed to the LLM has a write signature. There is no `set_reading()`, no `write_valve()`, no `update_anomaly()` — these functions simply do not exist in the tool registry.
- The agent's tool-calling loop is restricted to a fixed, enumerable list of read tools — the LLM cannot invent new tool calls that touch the database directly (no raw SQL execution tool is exposed).

## 3. Concurrency: reading a database that's being written to live

The existing SCADA system writes a new row every 5 seconds. The AI backend reads from the same file concurrently. To avoid `database is locked` errors:

- **WAL (Write-Ahead Logging) mode** is enabled on the SQLite database (`PRAGMA journal_mode=WAL;`). This allows one writer and multiple readers to operate concurrently without blocking each other.
- Reads are indexed on `timestamp` to keep query latency low even as the table grows (~17,000 rows/day at 5s sampling).
- "Live" data is not pushed to the AI layer — it's pulled on-demand when a query arrives (polling model, not streaming). This matches the chat-based interaction pattern (nobody needs sub-second push updates for a Q&A interface) and keeps Zone 3 simpler and fully decoupled from Zone 2's write cadence.

## 4. Query workflow (end-to-end)

```
User types query in PyQt chatbox
        ↓
FastAPI backend receives query, agent parses intent
        ↓
   ┌────────────┬──────────────────┬─────────────────┐
   │ Path A:     │ Path B:          │ Path C:          │
   │ Live/       │ Troubleshooting/ │ Data             │
   │ historical  │ SOP knowledge    │ visualisation    │
   │ data        │                  │                  │
   ↓             ↓                  ↓
get_live_reading()  RAG/GraphRAG    get_trend()
get_trend()         retrieve()      (rendering handled
                                     by existing SCADA
                                     visualisation)
   ↓             ↓
   └──── evidence merged ────┘
        ↓
Local SLM (via Ollama) synthesizes final NL response
from ONLY the retrieved evidence — never free-generates
numbers
        ↓
Response + source citation rendered in PyQt chat panel
```

## 5. Dual retrieval-track architecture (new addition — comparison study)

Both tracks share Zones 1/2/4 and the deterministic sensor-data tools. They diverge only in how they answer **Path B** (troubleshooting/SOP/domain-knowledge) queries:

```
                     ┌─────────────────────────────┐
                     │   Path B query received      │
                     └──────────────┬────────────────┘
                                    │
                 ┌──────────────────┴───────────────────┐
                 ↓                                        ↓
     TRACK 1: Traditional RAG               TRACK 2: Agentic GraphRAG
     ────────────────────────               ──────────────────────────
     1. Embed query                          1. Parse query into entities/intent
     2. Vector similarity search             2. Traverse knowledge graph
        against ChromaDB                        (entities: sensors, thresholds,
     3. Top-k chunks returned                    modes, anomalies, SOP steps)
     4. Chunks passed to SLM as               3. Agent may issue multiple graph
        context, single-shot                     queries / follow-up retrievals
                                              4. Agent may self-critique / re-query
                                                 if initial graph result is
                                                 insufficient (multi-hop reasoning)
                                              5. Aggregated subgraph passed to
                                                 SLM as structured context
                 └──────────────────┬───────────────────┘
                                    ↓
                    Both produce: (answer, sources, latency, hop-count)
                    → logged for the comparison framework
```

A **routing flag** (config or CLI parameter) determines which track handles a given session/query, so the same UI can be pointed at either backend and the same query set replayed against both. This is essential for the fairness of the comparison (see `04-rag-comparison-framework.md`).

## 6. Component responsibilities

| Component | Responsibility | Owned by |
|---|---|---|
| CO2SorptionDT PyQt5 app | Existing SCADA UI, sensor I/O, actuator control | Pre-existing (Ensonic) |
| IoT ingestion subsystem | Sensor → SQLite writes | Jason (teammate) |
| Anomaly detection subsystem | Anomaly labelling on ingested rows | Anson (teammate) |
| FastAPI backend | Intent routing, tool orchestration, both RAG tracks | This project |
| Traditional RAG engine | ChromaDB indexing + retrieval | This project |
| Agentic GraphRAG engine | Graph construction + agent traversal loop | This project |
| Model provider layer | Ollama model serving abstraction | This project |
| Hardware/model fit tool | Pre-flight model recommendation | This project (llmfit-inspired) |
| PyQt chat submodule | Chat UI tab embedded in CO2SorptionDT | This project |
| Trend interpretation engine | Numeric-to-NL summarisation of `get_trend()` output | This project |

## 7. Deployment target

- **Fully offline**, single lab machine (no network dependency for inference).
- Ollama as the local model-serving runtime for both SLM and LLM tiers.
- SQLite for structured sensor data (already exists).
- ChromaDB for the traditional RAG vector store.
- A lightweight embedded graph store for GraphRAG — candidates: NetworkX (in-memory, simplest, no server) for prototype scale, or Kùzu / SQLite with a graph schema layer if persistence and larger scale are needed. (See `03-agentic-graphrag-spec.md` for the tradeoff discussion.)
