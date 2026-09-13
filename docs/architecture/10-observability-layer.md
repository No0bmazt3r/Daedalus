# Layer 10: Observability, Audit Logging, and Evaluation Layer

> **Local Observability and Evaluation Harness**

* **Zone Mapping:** Supporting / Zone 3 Adjacent
* **Purpose:** Proves the system works, supports Objective 3 evaluation metrics, and allows debugging.
* **Crucial Distinction:** The AI is read-only regarding the *reactor*, but it *must* write to its own local audit logs.

---

## Traceability via query_id

Every query gets a unique `query_id` (e.g., `q_20260107_0001`) linking all logs:

```text
User query → Intent → Tool calls → SQLite evidence → RAG evidence
→ Ollama inference → Final response → Error (if any) → User feedback
```

If an examiner asks "How do you prove this response was grounded?":
```text
Query ID: q_20260107_0001
Tool used: get_live_reading
SQLite value: 470.2 ppm
LLM response: 470.2 ppm
Grounded: true
```

---

## Storage Strategy

**Separate databases — never mix sensor and log data:**
- Sensor DB: `/data/sqlite/sensor_readings.db`
- AI Log DB: `/data/logs/ai_logs.db`

**Fallback:** JSONL files for raw debug logs:
```text
/data/logs/conversation_logs.jsonl
/data/logs/tool_logs.jsonl
/data/logs/rag_logs.jsonl
/data/logs/model_logs.jsonl
/data/logs/error_logs.jsonl
```

---

## Log Schemas (SQLite)

### 1. Conversation Logs
```sql
CREATE TABLE conversation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    session_id TEXT,
    user_query TEXT,
    intent TEXT,
    selected_tools TEXT,
    model_used TEXT,
    response_text TEXT,
    grounded_flag INTEGER,
    hallucination_flag INTEGER,
    total_latency_ms INTEGER,
    error_message TEXT,
    user_feedback TEXT
);
```

### 2. Tool Execution Logs
```sql
CREATE TABLE tool_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id TEXT NOT NULL,
    query_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input_json TEXT,
    tool_output_summary TEXT,
    status TEXT,
    latency_ms INTEGER,
    error_message TEXT
);
```

### 3. RAG Retrieval Logs
```sql
CREATE TABLE rag_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id TEXT NOT NULL,
    query_id TEXT NOT NULL,
    vector_db_used TEXT,
    query_text TEXT,
    top_k INTEGER,
    retrieved_chunk_ids TEXT,
    retrieval_scores TEXT,
    source_files TEXT,
    retrieval_latency_ms INTEGER
);
```

### 4. Model Inference Logs
```sql
CREATE TABLE model_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id TEXT NOT NULL,
    query_id TEXT NOT NULL,
    model_name TEXT,
    temperature REAL,
    prompt_token_count INTEGER,
    completion_token_count INTEGER,
    time_to_first_token_ms INTEGER,
    total_inference_ms INTEGER,
    status TEXT,
    error_message TEXT
);
```

### 5. Error Logs
```sql
CREATE TABLE error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    query_id TEXT,
    component TEXT,  -- fastapi, intent_classifier, sqlite_tool, vector_db, ollama, response_validator, pyqt_client
    level TEXT,
    error_type TEXT,
    message TEXT,
    stack_trace TEXT
);
```

### 6. User Feedback Logs
```sql
CREATE TABLE feedback_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    evaluator_role TEXT,  -- e.g., chemical_engineering_student
    usefulness_score INTEGER,
    correctness_score INTEGER,
    comment TEXT
);
```

---

## Logging Performance

Logging must **not block** the chat response.

| Approach | Details |
|---|---|
| Simple | Write logs *after* the response is sent to the user |
| Better | Async logging via FastAPI `BackgroundTasks` or a simple queue |

For FYP, synchronous SQLite logging is acceptable if fast, but async is cleaner.

---

## Privacy Rules

| Do Log | Do NOT Log |
|---|---|
| User query, intent, tools used | Passwords |
| Retrieved chunk IDs, latency | API keys |
| Model used, response, errors | Personal identification |
| Feedback | System secrets, env variables |

> "All logs are stored locally and are not transmitted to external services."

---

## Docker-Hosted Log Viewer (Streamlit)

Positioned as: **Admin/Evaluation Log Viewer** (not the main operator chat interface).

### Features

1. **Conversation History:** Timestamp, user query, intent, tools, model, response, latency, grounded flag, error.
2. **Filter Panel:** Date range, intent, model, tool, success/error, latency threshold, grounded/hallucinated, session ID.
3. **Detailed Query View:** Full trace per query_id — user query, intent, safety check, tools, inputs, outputs, RAG chunks, prompt, model response, latency breakdown, error details.
4. **Error Dashboard:** Total errors, Ollama timeouts, SQLite failures, vector DB failures, invalid intent, unsafe request refusals.
5. **Evaluation View:** Avg/p50/p95 latency, groundedness rate, hallucination rate, RAG precision, user feedback score.

### Technology
**Streamlit** (fast to build, good tables/filters, runs in Docker, local only, no complex frontend).

---

## Evaluation Harness

### Golden Query Set

Minimum 20, good 50, strong 80+ queries.

| Category | Example Count |
|---|---|
| SOP/procedure queries | 10–15 |
| Manual queries | 8–12 |
| Anomaly queries | 5–10 |
| Troubleshooting | 5–10 |
| Ambiguous | 3–5 |

### Query Evaluation Set Examples

| Query ID | Query | Expected Relevant Chunk(s) |
|---|---|---|
| Q01 | What should I do if the NDIR reading drifts? | SOP_NDIR_Calibration chunk |
| Q02 | What is absorption mode? | Manual operating modes chunk |
| Q03 | What is the procedure for high pressure? | SOP pressure response chunk |
| Q04 | What happened during the last CO₂ anomaly? | Anomaly record chunk |
| Q05 | How do I interpret pH fluctuations? | Manual pH sensor chunk |

### Retrieval Metrics

| Metric | Definition |
|---|---|
| Precision@k | Relevant retrieved / k |
| Recall@k | Relevant retrieved / total relevant |
| MRR | Reciprocal rank of first relevant (1.00 for rank 1, 0.50 for rank 2) |

Recommended k values: **k = 3 and k = 5**.

### Target Metrics

| Metric | Target |
|---|---|
| RAG Precision@5 | > 80% |
| End-to-End Latency | < 3 seconds |
| Hallucination rate | < 10% |

Latency breakdown to measure: tool latency, retrieval latency, embedding latency, LLM latency, end-to-end. Report: average, p50, p95.

### Groundedness Checks

1. Are numerical values from SQLite?
2. Are timestamps correct?
3. Are SOP steps supported by retrieved chunks?
4. Are causal claims supported?
5. Did the model invent sensor names?
6. Did the model invent anomaly causes?

### Hybrid Evaluation Strategy (Local + Cloud)

To satisfy Objective 3 effectively, the evaluation leverages a dual-method approach. This allows immediate on-site checking as well as large-scale distributed checking, without compromising the reactor's offline safety rules.

**Method A: On-the-Spot Local Evaluation (Streamlit)**
* **Use Case:** For lab technicians or faculty who are physically present at the reactor PC.
* **Mechanism:** The local Streamlit Log Viewer (`http://localhost:8501`) has an "Evaluation Mode" where users can browse recent queries and submit 1-5 ratings directly into the local `feedback_logs` SQLite table.

**Method B: Distributed Automated Evaluation (n8n + Google Sheets)**
* **Use Case:** To achieve statistical significance by distributing queries to a larger pool of chemical engineering students/faculty remotely.
* **Mechanism:**
  1. **Export:** The local `ai_logs.db` is periodically exported.
  2. **n8n Automation:** An n8n workflow parses the exported logs and pushes them to a Google Sheet.
  3. **LLM-as-a-Judge:** n8n calls a cloud LLM (e.g., GPT-4o) to do an automated baseline pass, scoring responses for Groundedness.
  4. **Human Verification:** The Google Sheet is distributed to human evaluators to verify the LLM's scores and add their own ratings.
  5. **Data Aggregation:** Google Sheets automatically calculates the final metrics (<10% hallucination rate, >80% precision, <3s latency).

**Why this doesn't violate the rules:**
Method A is completely offline. Method B is an *asynchronous, offline evaluation workflow*. The n8n pipeline does not talk to the live reactor, does not run during live operator chat, and does not have access to the SCADA system. It strictly processes historical, exported AI logs.

---

## Diagram Elements

Side box next to FastAPI:
```text
Local Observability & Evaluation Layer
  - Conversation Logs, Tool Logs, RAG Logs
  - Model Logs, Error Logs, User Feedback
  - Local SQLite Log DB
  - Docker Log Viewer UI
```

Arrows:
```text
FastAPI → Local SQLite Log DB
Local SQLite Log DB → Docker Log Viewer UI
```

**Do NOT** draw an arrow from the log viewer to the reactor or SCADA. It only reads logs.

---

## Examiner Justifications

> "The read-only boundary applies to the reactor control layers. The AI layer writes to its own local audit database so that every query, tool call, and model response can be audited for groundedness and safety without transmitting data externally."

> "The logging layer is included to support Objective 3 and the evaluation metrics. Every query is assigned a unique query ID and is logged together with its intent, tool calls, retrieved evidence, model inference time, final response, and error state. These logs can be inspected through a local Docker-hosted log viewer without sending any laboratory data to external services."
