# Data Schema & Query Patterns

## 1. Sensor time-series table (existing, owned by Jason's ingestion subsystem)

```sql
CREATE TABLE sensor_readings (
    timestamp   DATETIME PRIMARY KEY,
    mode        TEXT CHECK(mode IN ('Manual', 'Absorption', 'Desorption')),
    temp_c      REAL,      -- T-101
    pressure_barg REAL,    -- P-101
    ph          REAL,      -- pH-101
    co2_ppm     REAL,      -- NDIR
    anomaly_status TEXT CHECK(anomaly_status IN ('Normal', 'Anomaly'))
);
CREATE INDEX idx_timestamp ON sensor_readings(timestamp);
```

Sample rows (from interim report Table 4):

| Date | Time | T-101 (°C) | P-101 (barg) | pH-101 | CO2 (ppm) | Mode |
|---|---|---|---|---|---|---|
| 7/1/2025 | 10:00:00 | 28.00 | 1.50 | 7.00 | 400.0 | Absorption |
| 7/1/2025 | 10:00:05 | 29.32 | 1.52 | 7.06 | 470.2 | Absorption |
| 7/1/2025 | 10:00:10 | 30.41 | 1.47 | 7.06 | 481.3 | Absorption |

**Volume:** ~17,000 rows per 24-hour run at 5-second sampling. Confirmed sufficient for hourly-mean-style trend queries without needing rollup/aggregation tables.

## 2. Read-only access pattern from the AI layer

```python
# Connection opened read-only — enforced at the driver level, not just by convention
conn = sqlite3.connect("file:reactor.db?mode=ro", uri=True)
```

## 3. Core deterministic query tools (shared by both RAG tracks)

### `get_live_reading()`
```sql
SELECT * FROM sensor_readings ORDER BY timestamp DESC LIMIT 1;
```

### `get_trend(sensor, start_time, end_time, aggregation)`
```sql
SELECT
    AVG(temp_c) as avg_temp,
    MIN(temp_c) as min_temp,
    MAX(temp_c) as max_temp
FROM sensor_readings
WHERE timestamp BETWEEN :start_time AND :end_time;
```
(Parameterized per requested sensor column — never string-concatenated, to avoid injection even though this is a read-only local tool.)

### `get_anomaly_status(start_time, end_time)`
```sql
SELECT timestamp, temp_c, pressure_barg, ph, co2_ppm, anomaly_status
FROM sensor_readings
WHERE anomaly_status = 'Anomaly' AND timestamp BETWEEN :start_time AND :end_time;
```

## 4. Concurrency configuration

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;  -- reasonable durability/perf tradeoff given the writer is a separate trusted subsystem
```

## 5. Document corpus (for both RAG tracks — the unstructured side)

| Type | Format | Approx. volume | Notes |
|---|---|---|---|
| Machine manuals | PDF | A handful of documents | Reactor rig operation, sensor specs |
| SOPs | PDF/DOCX | ~5–10 documents | Absorption/desorption startup, shutdown, safety procedures |
| Anomaly / UAUC records | Structured + free text | Grows over time as anomalies are logged | Feeds both the traditional RAG chunk store and the GraphRAG `AnomalyRecord` nodes |

## 6. Data flow ownership boundary (important for your report's clarity)

```
Jason's subsystem  →  writes sensor_readings table
Anson's subsystem  →  writes anomaly_status column (or a related anomaly detail table)
This project       →  READS both, writes only to its own vector store / graph store
                       (which are separate files/databases entirely from reactor.db)
```

Keeping the AI layer's own knowledge stores (ChromaDB directory, graph store file) physically separate from `reactor.db` is a clean architectural choice worth stating explicitly in your report — it means even a bug in your ingestion/indexing code cannot possibly corrupt the sensor data of record.
