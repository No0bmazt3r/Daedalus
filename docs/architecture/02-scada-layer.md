# Layer 2: SCADA and Data Acquisition Layer

> **SCADA Data Acquisition and Logging Layer**

* **Zone Mapping:** Zone 2
* **Purpose:** Reads sensor values from the physical reactor and stores them in a structured local database. Bridges the physical reactor and the AI layer.
* **Ownership:** Partially existing, partially coordinated with teammate (Jason — IoT ingestion). You are not building the full SCADA control system.

---

## Components

1. Existing CO2SorptionDT desktop application
2. Sensor polling/reading process
3. Data ingestion script
4. Local logging process
5. SQLite database writer
6. Optional teammate-side Supabase/dashboard sync (if used by wider team)

---

## Architecture Decision: Supabase vs Local SQLite

If the wider team uses Supabase for a dashboard, that Supabase layer must exist **outside** the AI trust boundary. The AI must read from a **local SQLite database** to preserve the offline constraint.

```text
Ingestion process → Supabase dashboard/team storage
                  ↘
                   Local SQLite for AI
```

> "The AI agent reads only from the local SQLite database."

---

## Data Written

Time-series rows at **5-second intervals** (~17,000 rows per 24-hour run):

```text
Timestamp, Date, Time, T-101 temperature, P-101 pressure,
pH-101 value, CO₂ ppm, Mode, Anomaly flag
```

Example:

| Timestamp | T-101 | P-101 | pH-101 | CO2 ppm | Mode | Anomaly |
|---|---:|---:|---:|---:|---|---|
| 2026-01-07 10:00:00 | 28.00 | 1.50 | 7.00 | 400.0 | Absorption | Normal |
| 2026-01-07 10:00:05 | 29.32 | 1.52 | 7.06 | 470.2 | Absorption | Normal |

This is small enough for SQLite and suitable for trend queries.

---

## Diagram Elements

```text
CO2SorptionDT SCADA
Sensor Reader
Ingestion Script
SQLite Writer
Local SQLite DB
```

Optional outside boundary:
```text
Supabase team dashboard (not part of AI trust boundary)
```

> **Boundary Statement:** "Data acquisition layer is read by the AI layer, but the AI layer does not write to SCADA or sensors."
