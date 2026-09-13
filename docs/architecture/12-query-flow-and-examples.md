# Query Flow, Examples & Data Flows

---

## Master Runtime Flow

```text
User Query → PyQt Chat Panel → FastAPI /api/chat → Query Normalizer
→ Intent Classification & Safety Guard → Tool Planner → Deterministic Tools (SQLite/ChromaDB)
→ Evidence Pack → Prompt Builder → Ollama Local SLM → Response Validator
→ PyQt (with Citations) → Background Task writes to Local Audit Logs.
```

---

## Query Type Examples

### Example 1: Live Status Query

**User:** "What is the current temperature?"

```text
Intent: live_status
Tool: get_live_reading(sensor="temperature")
SQLite returns 28.0°C
Evidence pack created
LLM summarizes
UI shows: "The current temperature is 28.0°C." [Source: SQLite 10:00:05]
```

---

### Example 2: Trend Query

**User:** "What was the average CO₂ level over the past hour?"

```text
Intent: trend_query
Tool: get_trend(sensor="co2_ppm", aggregation="average", start_time="09:05:00", end_time="10:05:00")
SQLite returns 452.7 ppm
LLM summarizes
UI shows: "The average CO₂ level over the past hour was 452.7 ppm." [Source: SQLite trend query]
```

---

### Example 3: SOP Query

**User:** "What should I do if the NDIR reading drifts?"

```text
Intent: sop_query
Tool: rag_retrieve(query="NDIR reading drifts")
Vector DB returns SOP chunk
LLM summarizes SOP chunk
UI shows grounded procedural advice [Source: SOP_NDIR_Calibration.pdf, Page 4]
```

---

### Example 4: Mixed Diagnostic Query

**User:** "Why did the CO₂ reading spike at 10:00?"

```text
Intent: mixed_query
Tools:
    get_trend(sensor="co2_ppm", around 10:00)
    get_anomaly_summary(around 10:00)
    rag_retrieve("CO₂ spike troubleshooting")
Evidence:
    CO₂ rose from 420 ppm to 980 ppm
    Anomaly flag present
    SOP suggests checking NDIR calibration and gas flow
```

Example answer:
```text
At around 10:00, the CO₂ reading increased sharply from 420 ppm to 980 ppm.
The database records an anomaly flag during this period.
The SOP suggests checking NDIR calibration and gas flow.
```

**Important:** The system should NOT say "The valve failed" unless there is explicit evidence. Causal claims must be supported.

---

### Example 5: Unsafe Control Query

**User:** "Open valve ABV-1."

```text
Intent: unsafe_control
Safety guard blocks tool execution
System responds: "I cannot control the reactor. I only provide read-only monitoring information."
No LLM generation needed.
```

---

### Example 6: Out of Scope

**User:** "Send an email" / "Book a meeting"

```text
Intent: out_of_scope
Handled without tools — appropriate refusal response.
```

---

## Full Example Response

| Query Type | User Query | System Flow & Evidence | Final Output |
| :--- | :--- | :--- | :--- |
| **Live Status** | "Current temperature?" | `live_status` → `get_live_reading("temperature")` → 28.0 | "28.0°C" `[Source: SQLite 10:00:05]` |
| **Trend** | "Avg CO₂ last hour?" | `trend` → `get_trend("co2_ppm", avg)` → 452.7 | "452.7 ppm" `[Source: SQLite Trend]` |
| **SOP** | "NDIR drifts?" | `sop` → `rag_retrieve()` → SOP chunk | "Calibrate per Section 4.2..." `[Source: SOP_NDIR.pdf, p.4]` |
| **Mixed** | "Why CO₂ spike at 10:00?" | `mixed` → `get_trend()` + `get_anomaly_summary()` + `rag_retrieve()` | Combined sensor + anomaly + SOP evidence |
| **Unsafe** | "Open valve ABV-1" | `unsafe_control` → Safety Guard blocks | "I cannot control the reactor." |

---

## Data Flow Diagrams

### Data Flow 1: Sensor Data Flow
```text
Physical sensors → SCADA data acquisition → Local SQLite sensor database
→ FastAPI deterministic tools → Evidence pack → Local SLM → Natural language response
```

### Data Flow 2: Knowledge Data Flow
```text
SOP/manual/anomaly documents → Local text extraction → Chunking and metadata
→ Local embedding model → ChromaDB vector store → rag_retrieve()
→ Evidence pack → Local SLM → Grounded response
```

### Data Flow 3: User Query Flow
```text
User question → PyQt chat panel → FastAPI /api/chat → Intent classification
→ Tool selection → Evidence retrieval → Prompt construction
→ Ollama inference → Validated response → PyQt answer with citations
```

### Data Flow 4: Observability Flow
```text
User Query → FastAPI Backend → Creates query_id → Executes tools
→ Retrieves evidence → Calls Ollama → Returns response to PyQt
→ Writes logs to local log database → Docker log viewer reads logs
```
