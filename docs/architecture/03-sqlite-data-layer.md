# Layer 3: Local AI Data Layer (Sensor DB)

> **Local Read-Only Sensor Data Layer**

* **Zone Mapping:** Zone 3 (Data Sub-layer)
* **Purpose:** Structured operational data store used by AI tools. Contains live/historical readings, operating modes, and anomaly flags.
* **Technology:** **SQLite** (Serverless, local, lightweight, file-based, offline, SQL-queryable, suitable for time-series rows at this scale, easy Python integration).

---

## Database Schema

### Primary Table: sensor_readings

```sql
CREATE TABLE sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL, -- ISO format: 2026-01-07T10:00:05
    temperature REAL,
    pressure REAL,
    ph REAL,
    co2_ppm REAL,
    mode TEXT,
    anomaly_flag TEXT
);
```

### Indexes

```sql
CREATE INDEX idx_sensor_timestamp ON sensor_readings(timestamp);
CREATE INDEX idx_sensor_mode ON sensor_readings(mode);           -- If mode filtering is common
CREATE INDEX idx_sensor_anomaly ON sensor_readings(anomaly_flag); -- If anomaly filtering is common
```

### Optional Table: anomaly_records

If anomaly data is stored separately:

```sql
CREATE TABLE anomaly_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT,
    end_time TEXT,
    anomaly_type TEXT,
    severity TEXT,
    description TEXT
);
```

---

## Data Access Rules

FastAPI backend opens SQLite in **read-only mode**:
```text
AI tools → SELECT only
AI tools → no INSERT
AI tools → no UPDATE
AI tools → no DELETE
```

---

## Supported Queries

The database must support queries such as:

1. Current temperature
2. CO₂ value at a specific time
3. Average temperature over the last hour
4. Maximum pressure during absorption mode
5. Whether an anomaly occurred this morning
6. Sensor trend over a selected time range

---

## Data Validation

The data layer should handle:
- Missing values
- Null sensor fields
- Duplicate timestamps
- Invalid mode labels
- Missing anomaly flags
- Time zone consistency
- Date/time normalization

---

## Recommended Improvement

Use one ISO timestamp instead of separate Date and Time columns:
```text
2026-01-07T10:00:05
```
This makes SQL queries cleaner.

---

## Diagram Elements

Database cylinder labeled:
```text
Local SQLite Sensor DB
  - sensor_readings
  - anomaly_records
  Label: "Read-only for AI layer"
```

> **Boundary Statement:** "The AI layer accesses the sensor database in read-only mode via parameterized SQL queries."
