# Layer 8: Deterministic Tool Layer

> **Deterministic Tool Layer**

* **Zone Mapping:** Zone 3
* **Purpose:** Prevents hallucination by ensuring the LLM never queries databases directly. Tools fetch exact data.

```text
Numbers come from SQLite
SOPs come from RAG
LLM only summarizes evidence
```

---

## Core Tools (keep these four for FYP)

### Tool 1: `get_live_reading(sensor, timestamp)`

**Purpose:** Retrieve current or specific-time sensor value.

**Input:**
```json
{
  "sensor": "temperature | pressure | ph | co2_ppm | mode | anomaly_flag",
  "timestamp": "optional ISO timestamp"
}
```

**Output:**
```json
{
  "sensor": "co2_ppm",
  "value": 470.2,
  "unit": "ppm",
  "timestamp": "2026-01-07T10:00:05",
  "mode": "Absorption",
  "anomaly_flag": "Normal"
}
```

**SQL Behavior:**

No timestamp:
```sql
SELECT * FROM sensor_readings ORDER BY timestamp DESC LIMIT 1;
```

With timestamp:
```sql
SELECT * FROM sensor_readings WHERE timestamp = ? LIMIT 1;
```

Use **parameterized queries** always.

---

### Tool 2: `get_trend(sensor, start_time, end_time, aggregation, mode_filter)`

**Purpose:** Retrieve aggregated trend data over a time range.

**Input:**
```json
{
  "sensor": "temperature | pressure | ph | co2_ppm",
  "start_time": "ISO timestamp",
  "end_time": "ISO timestamp",
  "aggregation": "average | min | max | count | latest | first",
  "mode_filter": "optional"
}
```

**Output:**
```json
{
  "sensor": "temperature",
  "aggregation": "average",
  "value": 29.4,
  "unit": "°C",
  "start_time": "2026-01-07T09:00:00",
  "end_time": "2026-01-07T10:00:00",
  "sample_count": 720
}
```

**Optional Series Output:**
```json
{
  "series": [
    { "timestamp": "2026-01-07T09:00:00", "value": 28.7 },
    { "timestamp": "2026-01-07T09:00:05", "value": 28.9 }
  ]
}
```

Limit series length: `max_points = 100` to avoid huge prompts.

---

### Tool 3: `get_anomaly_summary(start_time, end_time, limit)`

**Purpose:** Retrieve anomaly occurrences in a time range.

**Input:**
```json
{
  "start_time": "ISO timestamp",
  "end_time": "ISO timestamp",
  "limit": 10
}
```

**Output (from sensor_readings):**
```json
{
  "anomaly_count": 1,
  "anomalies": [{
    "timestamp": "2026-01-07T09:42:10",
    "anomaly_flag": "Anomaly",
    "co2_ppm": 980.4,
    "mode": "Absorption"
  }]
}
```

**Output (from anomaly_records table, if exists):**
```json
{
  "anomaly_count": 1,
  "anomalies": [{
    "start_time": "2026-01-07T09:40:00",
    "end_time": "2026-01-07T09:45:00",
    "anomaly_type": "High CO₂",
    "severity": "medium",
    "description": "CO₂ exceeded expected absorption range."
  }]
}
```

---

### Tool 4: `rag_retrieve(query, top_k, source_types, reactor_mode)`

**Purpose:** Retrieve relevant SOP/manual/anomaly knowledge chunks.

**Input:**
```json
{
  "query": "string",
  "top_k": 5,
  "source_types": ["sop", "manual", "anomaly", "uauc"],
  "reactor_mode": "optional"
}
```

**Output:**
```json
{
  "query": "NDIR reading drifts",
  "results": [{
    "chunk_id": "sop_ndir_drift_004",
    "text": "If the NDIR reading drifts...",
    "score": 0.87,
    "source_file": "SOP_NDIR_Calibration.pdf",
    "source_type": "sop",
    "section_title": "Drift Correction",
    "page_number": 4
  }]
}
```

---

## Optional Future Tools (not needed for FYP)
```text
get_mode_context()
get_experiment_summary()
get_recent_anomalies()
```

---

## Tool Security Rules

1. **Whitelisted sensor names:** `temperature, pressure, ph, co2_ppm, mode, anomaly_flag`
2. **Whitelisted aggregation functions:** `average, min, max, count, latest, first`
3. **Parameterized SQL only** — no raw SQL from LLM
4. **No write queries**
5. **Query timeout** enforced
6. **Result size limit** enforced
7. **Error messages** without leaking sensitive internals

---

## Diagram Elements

Four tool boxes:
```text
get_live_reading()
get_trend()
get_anomaly_summary()
rag_retrieve()
```

Arrows:
```text
FastAPI → get_live_reading → SQLite
FastAPI → get_trend → SQLite
FastAPI → get_anomaly_summary → SQLite
FastAPI → rag_retrieve → ChromaDB
```

Red crossed-out arrow:
```text
No write path to SCADA/actuators
```
