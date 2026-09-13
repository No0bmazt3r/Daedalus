# Deployment, Folder Structure & Docker

---

## Recommended Folder Structure

```text
fyp-conversational-agentic-ai/
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── chat.py
│   │   │   └── health.py
│   │   ├── agent/
│   │   │   ├── orchestrator.py
│   │   │   ├── intent.py
│   │   │   ├── safety.py
│   │   │   ├── planner.py
│   │   │   ├── evidence.py
│   │   │   └── prompt.py
│   │   ├── tools/
│   │   │   ├── live_reading.py
│   │   │   ├── trend.py
│   │   │   ├── anomaly.py
│   │   │   └── rag.py
│   │   ├── db/
│   │   │   ├── sqlite_client.py
│   │   │   └── queries.py
│   │   ├── rag/
│   │   │   ├── chroma_store.py
│   │   │   ├── embeddings.py
│   │   │   └── retriever.py
│   │   ├── models/
│   │   │   ├── ollama_client.py
│   │   │   └── config_loader.py
│   │   └── logging/
│   │       └── query_logger.py
│   └── tests/
│
├── ingestion/
│   ├── documents/
│   ├── chunker.py
│   ├── cleaner.py
│   ├── metadata_builder.py
│   ├── embedder.py
│   └── ingest_to_vector_db.py
│
├── eval/
│   ├── golden_queries.json
│   ├── groundedness_eval.py
│   ├── retrieval_eval.py
│   ├── latency_eval.py
│   ├── vector_db_benchmark.py
│   └── user_feedback/
│
├── admin/
│   ├── model_selector.py      # Streamlit UI for model management
│   ├── log_viewer_app.py      # Streamlit UI for audit logs
│   ├── hardware_profiler.py
│   └── benchmark_runner.py
│
├── config/
│   ├── model_config.json
│   └── tool_config.json
│
├── data/
│   ├── sqlite/                # sensor_readings.db
│   ├── chroma/                # Vector DB persistent storage
│   ├── documents/
│   │   ├── manuals/
│   │   ├── sops/
│   │   ├── anomaly_records/
│   │   └── uauc_records/
│   └── logs/                  # ai_logs.db, jsonl fallbacks
│
└── docker-compose.yml
```

---

## Docker Compose

```yaml
services:
  api:
    build: ./backend
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - ./data:/data
      - ./logs:/logs

  chroma:
    image: chromadb/chroma
    volumes:
      - ./data/chroma:/chroma/chroma

  log-viewer:
    build: ./admin/log_viewer
    ports:
      - "127.0.0.1:8501:8501"
    volumes:
      - ./data/logs:/data/logs

  admin-ui:
    build: ./admin/model_selector
    ports:
      - "127.0.0.1:8502:8502"
```

---

## Deployment Options

| Option | Details |
|---|---|
| **Full Docker** | All services containerized |
| **Hybrid** | Ollama on host (GPU access), FastAPI + ChromaDB in Docker |
| **All Local** | All local processes without Docker |

Ollama may run on host instead of Docker if GPU access is easier.

---

## LAN Access

For lab users on the same network, change:
```yaml
ports:
  - "8501:8501"   # instead of 127.0.0.1:8501:8501
```

But explain:
> "The log viewer is hosted locally inside Docker and is only accessible on localhost or the trusted laboratory LAN. It does not use any external cloud service."

---

## Architecture Diagram

```text
┌────────────────────────────────────────────────────────────┐
│ Zone 1: Physical CO₂ Sorption Reactor                      │
│ - Reactor column, T-101, P-101, pH-101, NDIR, ABV valves   │
└──────────────────────────┬─────────────────────────────────┘
                           │ sensor readings
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Zone 2: SCADA / Data Acquisition                           │
│ - CO2SorptionDT, Ingestion script, SQLite writer           │
└──────────────────────────┬─────────────────────────────────┘
                           │ 5-second interval rows
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Local SQLite Sensor DB (Read-Only for AI)                  │
│ - sensor_readings, anomaly_records                         │
└──────────────────────────┬─────────────────────────────────┘
                           │ read-only SQL
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Zone 3: Read-Only AI SCADA Layer                           │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ FastAPI Agentic Backend                              │  │
│  │ - Query Normalizer  - Intent Classifier              │  │
│  │ - Safety Guard      - Tool Planner                   │  │
│  │ - Evidence Builder  - Prompt Builder                 │  │
│  │ - Response Validator - Logger                        │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                    │
│                       ▼                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Deterministic Tool Layer                             │  │
│  │ - get_live_reading()  - get_trend()                  │  │
│  │ - get_anomaly_summary() - rag_retrieve()             │  │
│  └──────────────┬──────────────────────┬────────────────┘  │
│                 │                      │                   │
│                 ▼                      ▼                   │
│  ┌──────────────────────┐   ┌────────────────────────┐     │
│  │ Local SQLite Queries │   │ Local Vector Retrieval │     │
│  │ SELECT only          │   │ ChromaDB (Production)  │     │
│  └──────────────────────┘   └───────────┬────────────┘     │
│                                         │                  │
│                                         ▼                  │
│                             ┌────────────────────────┐     │
│                             │ Local Embedding Model  │     │
│                             │ (nomic-embed-text)     │     │
│                             └────────────────────────┘     │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Ollama Local Model Provider                          │  │
│  │ - Qwen3 1.7B, Phi-3 Mini, Gemma 3 1B (Quantized)    │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬─────────────────────────────────┘
                           │ grounded response
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Zone 4: PyQt5 Presentation Layer                           │
│ - Chat panel, History, Citations, Loading states           │
└────────────────────────────────────────────────────────────┘
```

---

## Red Boundary (for diagrams)

Draw a red boundary around Zone 3:
```text
Read-only boundary
No writes to SCADA
No actuator control
No cloud runtime
```
