# Design Rules & System Zones

## Architecture Name

> **Local-First Conversational Agentic AI Architecture for Read-Only CO₂ Sorption Reactor Monitoring**

This name communicates: **Local-first** (no cloud), **Conversational** (NL interface), **Agentic** (tool-calling, not free generation), **Read-only** (safety boundary), **CO₂ sorption reactor monitoring** (domain focus).

---

## Non-Negotiable Design Rules

### Rule 1: Production system must be 100% local
No cloud APIs are allowed in the runtime system.
* **Forbidden in Runtime:** OpenAI, Anthropic, Google Gemini API, Cloud vector DBs (Pinecone, MongoDB Atlas), Cloud logging, Cloud dashboards, Google Sheets, Hosted embedding APIs, Hugging Face hosted inference.
* **Allowed:** Cloud LLMs may *only* appear as external benchmark baselines in the evaluation layer, never as production components.

### Rule 2: AI layer must be strictly read-only
The AI layer can read from the local SQLite sensor database and the local vector knowledge base.
* **Forbidden Writes:** SCADA control systems, reactor actuators, automated ball valves (ABVs), sensor hardware, teammate's anomaly detection subsystem, external dashboards.
* **Allowed Writes:** The AI layer *can and should* write to its own local audit/evaluation logs (chat logs, tool logs, retrieval logs, model inference logs, error logs, user feedback logs). These belong to the AI layer, not the reactor control layer, and do not violate the read-only safety boundary.
* **Safety Argument:** This is the primary safety boundary preventing the AI from altering physical lab states.

### Rule 3: Numerical values must come from tools, not the LLM
The LLM must never invent or hallucinate numerical sensor data.
* **Correct Flow:** `SQLite DB` → `get_live_reading()` → `Evidence Object` → `LLM Summarization`.
* **Incorrect Flow:** `LLM Memory/Weights` → `Direct Number Generation`.

### Rule 4: SOP/troubleshooting answers must come from RAG
Procedural and troubleshooting advice must be grounded in retrieved documents.
* **Correct Flow:** `SOP/Manual Document` → `Local Embedding` → `Vector Retrieval` → `LLM Summarization`.
* **Constraint:** If no relevant document is retrieved, the system must state that the information is unavailable rather than guessing.

### Rule 5: Setup tools are not runtime tools
Utilities like the **Model Selector Console**, **LLM Checker**, **AirLLM**, and **Vector DB Benchmark Harness** are strictly administrative/setup utilities. They do not sit in the live user query execution path.

---

## High-Level System Zones

The architecture maps to four distinct physical and logical zones, aligning with the interim report.

| Zone | Name | Description |
|---|---|---|
| Zone 1 | Physical CO₂ Sorption Reactor | Existing hardware, sensors, actuators |
| Zone 2 | SCADA / Data Acquisition Layer | Existing CO2SorptionDT app, ingestion scripts, local SQLite writer |
| Zone 3 | Read-Only AI SCADA Layer | **Your main FYP contribution:** FastAPI agent, local SLM, RAG, Vector DB, Tools |
| Zone 4 | PyQt5 Presentation Layer | The chat panel embedded inside the CO2SorptionDT desktop app |

---

## 11-Layer Overview

```text
 1. Physical Reactor and Sensor Layer          (Zone 1)
 2. SCADA Data Acquisition Layer               (Zone 2)
 3. Local SQLite Sensor Data Layer             (Zone 3 — Data)
 4. Domain Knowledge Ingestion Layer           (Setup/Offline)
 5. Local Vector Retrieval Layer               (Zone 3)
 6. Local Model Provider Layer                 (Zone 3)
 7. FastAPI Agentic Orchestration Layer        (Zone 3 — Core Brain)
 8. Deterministic Tool Layer                   (Zone 3)
 9. PyQt5 Presentation Layer                   (Zone 4)
10. Observability and Evaluation Layer         (Supporting)
11. Administrative Utility Layer               (Setup/Support)
```

### Short Version (for slides)
```text
1. Physical/SCADA Data Layer
2. Local SQLite Data Layer
3. Local RAG Knowledge Layer
4. Local Model Provider Layer
5. FastAPI Agentic Core
6. PyQt Chat Interface
7. Evaluation and Admin Utilities
```
