"""Sensor telemetry store (Layer 3) — READ-ONLY from the AI layer.

The SCADA ingestion subsystem owns every write to this database. Daedalus
opens it with `mode=ro`, so the driver itself rejects INSERT/UPDATE/DELETE —
the read-only boundary is enforced below the application, where a prompt
injection or a coding mistake cannot reach it.

`init_schema()` and `seed_demo()` exist for development only, when no real
SCADA writer is running. They open a separate read-write connection and are
never called from the query path.
"""

from __future__ import annotations

import random
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from .paths import SENSOR_DB, ensure_dirs

# Friendly tool-facing names → real columns. The tool layer only ever accepts
# a key from this map, so no caller-supplied string reaches SQL.
SENSOR_COLUMNS = {
    "temperature": "temp_c",
    "pressure": "pressure_barg",
    "ph": "ph",
    "level": "level_pct",
    "co2_ppm": "co2_ppm",
    "mode": "mode",
    "anomaly_flag": "anomaly_status",
}

SENSOR_UNITS = {
    "temperature": "°C",
    "pressure": "barg",
    "ph": "",
    "level": "%",
    "co2_ppm": "ppm",
}

AGGREGATIONS = {
    "average": "AVG",
    "min": "MIN",
    "max": "MAX",
    "count": "COUNT",
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sensor_readings (
    timestamp      TEXT PRIMARY KEY,
    device_id      TEXT NOT NULL DEFAULT 'co2_reactor_01',
    mode           TEXT CHECK(mode IN ('Manual','Absorption','Desorption')),
    temp_c         REAL,
    pressure_barg  REAL,
    ph             REAL,
    level_pct      REAL,
    co2_ppm        REAL,
    anomaly_status TEXT CHECK(anomaly_status IN ('Normal','Anomaly'))
);

CREATE TABLE IF NOT EXISTS anomaly_records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time   TEXT,
    end_time     TEXT,
    device_id    TEXT DEFAULT 'co2_reactor_01',
    anomaly_type TEXT,
    severity     TEXT,
    description  TEXT,
    resolution   TEXT
);

CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON sensor_readings(timestamp);
CREATE INDEX IF NOT EXISTS idx_readings_anomaly   ON sensor_readings(anomaly_status);
CREATE INDEX IF NOT EXISTS idx_readings_mode      ON sensor_readings(mode);
"""


@contextmanager
def connect_ro() -> Iterator[sqlite3.Connection]:
    """Read-only connection. Any write raises `sqlite3.OperationalError`."""
    ensure_dirs()
    if not SENSOR_DB.exists():
        raise FileNotFoundError(
            f"sensor database not found at {SENSOR_DB} — "
            "run the SCADA ingestion subsystem, or seed a demo set for development"
        )
    conn = sqlite3.connect(f"file:{SENSOR_DB}?mode=ro", uri=True, timeout=5.0)
    try:
        conn.row_factory = sqlite3.Row
        yield conn
    finally:
        conn.close()


@contextmanager
def _connect_rw() -> Iterator[sqlite3.Connection]:
    """Development only — schema creation and demo seeding."""
    ensure_dirs()
    conn = sqlite3.connect(SENSOR_DB, timeout=5.0)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_schema() -> None:
    """Create the tables if absent. Dev convenience; SCADA owns this in prod."""
    with _connect_rw() as conn:
        conn.executescript(_SCHEMA)


def seed_demo(hours: int = 6, interval_s: int = 5) -> int:
    """Generate a plausible run so the UI has something to query offline.

    Not a simulator — just enough shape (a diurnal drift plus one injected CO₂
    excursion) to exercise live, trend and anomaly queries.
    """
    init_schema()
    with _connect_rw() as conn:
        existing = conn.execute("SELECT COUNT(*) AS n FROM sensor_readings").fetchone()["n"]
        if existing:
            return 0

        now = datetime.now(timezone.utc).replace(microsecond=0)
        start = now - timedelta(hours=hours)
        rows: list[tuple[Any, ...]] = []
        steps = int(hours * 3600 / interval_s)
        # One anomalous window, roughly two-thirds of the way through.
        anomaly_at = int(steps * 0.66)
        anomaly_len = int(300 / interval_s)

        for i in range(steps):
            ts = start + timedelta(seconds=i * interval_s)
            phase = i / steps
            anomalous = anomaly_at <= i < anomaly_at + anomaly_len
            mode = "Absorption" if phase < 0.6 else "Desorption"

            co2 = 400 + 90 * phase + random.uniform(-8, 8)
            if anomalous:
                co2 += 480 + random.uniform(-30, 30)

            rows.append((
                ts.isoformat(),
                "co2_reactor_01",
                mode,
                round(28 + 4 * phase + random.uniform(-0.4, 0.4), 2),
                round(1.5 + 0.3 * phase + random.uniform(-0.03, 0.03), 3),
                round(7.0 - 0.35 * phase + random.uniform(-0.05, 0.05), 2),
                round(62 - 9 * phase + random.uniform(-0.6, 0.6), 1),
                round(co2, 1),
                "Anomaly" if anomalous else "Normal",
            ))

        conn.executemany(
            "INSERT OR IGNORE INTO sensor_readings "
            "(timestamp, device_id, mode, temp_c, pressure_barg, ph, level_pct, co2_ppm, anomaly_status) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            rows,
        )
        anomaly_start = start + timedelta(seconds=anomaly_at * interval_s)
        conn.execute(
            "INSERT INTO anomaly_records "
            "(start_time, end_time, device_id, anomaly_type, severity, description, resolution) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                anomaly_start.isoformat(),
                (anomaly_start + timedelta(seconds=anomaly_len * interval_s)).isoformat(),
                "co2_reactor_01",
                "High CO₂",
                "medium",
                "CO₂ concentration exceeded the expected absorption range.",
                "NDIR recalibrated; gas flow verified.",
            ),
        )
        return len(rows)


def stats() -> dict[str, Any]:
    """Row counts and coverage window — for Settings → Databases."""
    if not SENSOR_DB.exists():
        return {"exists": False, "rows": 0, "anomalies": 0, "earliest": None, "latest": None}
    with connect_ro() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n, MIN(timestamp) AS earliest, MAX(timestamp) AS latest "
            "FROM sensor_readings"
        ).fetchone()
        anomalies = conn.execute(
            "SELECT COUNT(*) AS n FROM sensor_readings WHERE anomaly_status = 'Anomaly'"
        ).fetchone()["n"]
        return {
            "exists": True,
            "rows": row["n"],
            "anomalies": anomalies,
            "earliest": row["earliest"],
            "latest": row["latest"],
        }
