# Layer 7: FastAPI Agentic Orchestration Layer

> **FastAPI Agentic Orchestration Layer**

* **Zone Mapping:** Zone 3 (Core Brain)
* **Purpose:** Receives user queries, classifies intent, enforces safety, plans tool calls, builds evidence packs, constructs prompts, calls Ollama, and validates responses. **This is the brain of the FYP.**
* **Technology:** **FastAPI** (Async, local REST API, structured request/response validation, automatic OpenAPI docs).

---

## Main Endpoint

`POST /api/chat`

### Request
```json
{
  "query": "What is the current CO₂ level?",
  "session_id": "optional-session-id"
}
```

### Response
```json
{
  "answer": "The current CO₂ level is 470.2 ppm.",
  "intent": "live_status",
  "tools_used": ["get_live_reading"],
  "citations": [{
    "type": "sqlite",
    "sensor": "co2_ppm",
    "timestamp": "2026-01-07T10:00:05",
    "value": 470.2
  }],
  "latency_ms": 1480,
  "grounded": true
}
```

---

## 11-Step Orchestration Flow

### Step 1: Receive Query
```text
User query → PyQt sends POST /api/chat → FastAPI
```

### Step 2: Normalize Query
- Trim whitespace
- Detect empty query
- Detect overly long query
- Detect unsupported language if needed
- Detect control-related keywords

### Step 3: Classify Intent

| Intent | Example |
|---|---|
| `live_status` | "What is the current temperature?" |
| `historical_query` | "What was CO₂ at 10:00?" |
| `trend_query` | "Average temperature over the last hour?" |
| `anomaly_query` | "Was there an anomaly this morning?" |
| `sop_query` | "What should I do if NDIR drifts?" |
| `mixed_query` | "Why did CO₂ spike at 10:00?" |
| `unsafe_control` | "Open valve ABV-1" |
| `out_of_scope` | "Book a meeting" |

### Step 4: Safety Check

If query is control-related ("Open valve", "Start desorption", "Turn off sensor", "Change mode"):
```text
Return: "I cannot control the reactor. I only provide read-only monitoring information."
No tool execution. No LLM guessing.
```

### Step 5: Plan Tool Calls

| Intent | Tools |
|---|---|
| `live_status` | `get_live_reading()` |
| `historical_query` | `get_live_reading(timestamp)` |
| `trend_query` | `get_trend()` |
| `anomaly_query` | `get_anomaly_summary()` or `get_trend()` + anomaly filter |
| `sop_query` | `rag_retrieve()` |
| `mixed_query` | `get_trend()` + `get_anomaly_summary()` + `rag_retrieve()` |

### Step 6: Execute Tools
Call deterministic tools with parameterized inputs.

### Step 7: Create Evidence Pack
```json
{
  "sensor_evidence": [{
    "sensor": "co2_ppm",
    "timestamp": "2026-01-07T10:00:05",
    "value": 470.2,
    "mode": "Absorption",
    "anomaly_flag": "Normal"
  }],
  "rag_evidence": [{
    "chunk_id": "sop_ndir_drift_004",
    "text": "If the NDIR reading drifts...",
    "source_file": "SOP_NDIR_Calibration.pdf",
    "page_number": 4
  }]
}
```

### Step 8: Build Prompt

The prompt contains:
1. System instruction
2. Safety rules
3. Evidence
4. User query
5. Citation requirement

System instruction:
```text
You are a read-only laboratory monitoring assistant for a CO₂ sorption reactor.
Answer only using the provided evidence.
Do not invent numerical values.
If the evidence is insufficient, say that the information is unavailable.
Do not provide control commands.
Cite the source of each factual claim.
```

### Step 9: Call Local Model
```text
FastAPI → Ollama → local SLM
```

### Step 10: Validate Response

Check:
- Is response empty?
- Does response contain numbers not present in evidence?
- Does response mention control actions?
- Does response exceed length limit?
- Did model timeout?

If validation fails:
```text
"I could not generate a grounded answer from the available data."
```

### Step 11: Return Response to UI
```text
Answer + Citations + Tools used + Latency + Warnings
```

---

## Internal Module List

```text
API Router
Query Normalizer
Intent Classifier
Safety Guard
Tool Planner
Tool Executor
Evidence Builder
Prompt Builder
Model Client
Response Validator
Logger
```

---

## Diagram Elements

Large box labeled `FastAPI Agentic Backend` with modules inside.

Arrows:
```text
PyQt → FastAPI
FastAPI → Tools
Tools → SQLite
Tools → Vector DB
FastAPI → Ollama
FastAPI → Logs
FastAPI → PyQt
```

> **Boundary Statement:** "The orchestration layer is read-only with respect to the reactor. It only queries local data and knowledge stores."
