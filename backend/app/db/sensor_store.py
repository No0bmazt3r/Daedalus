"""Sensor telemetry store (Layer 3) — READ-ONLY from the AI layer.

The SCADA ingestion subsystem owns every write to this database. Daedalus
opens it with `mode=ro`, so the driver itself rejects INSERT/UPDATE/DELETE —
the read-only boundary is enforced below the application, where a prompt
injection or a coding mistake cannot reach it.

`init_schema()` and `seed_demo()` exist for development only, when no real
SCADA writer is running. They open a separate read-write connection and are
never called from the query path.

`ingest()` is the one production write: rows CO2SorptionDT's Daedalus link
posts to `/api/ingest/readings`. It also opens its own read-write connection,
so the query path stays `mode=ro` however the rows arrive.
"""

from __future__ import annotations

import os
import random
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from .paths import SENSOR_DB, ensure_dirs

# The rig this database describes. CO2SorptionDT logs no device column, so the
# writer stamps this id; a row (or a whole file) without one is read as this rig.
DEFAULT_DEVICE_ID = "mini-co2-rig-01"


def device_id() -> str:
    return os.environ.get("DAEDALUS_DEVICE_ID", "").strip() or DEFAULT_DEVICE_ID


# Friendly tool-facing names → real columns. The tool layer only ever accepts
# a key from this map, so no caller-supplied string reaches SQL.
SENSOR_COLUMNS = {
    "temperature": "temp_c",
    "pressure": "pressure_barg",
    "ph": "ph",
    "co2_ppm": "co2_ppm",
    "mode": "mode",
}

SENSOR_UNITS = {
    "temperature": "°C",
    "pressure": "barg",
    "ph": "",
    "co2_ppm": "ppm",
}

AGGREGATIONS = {
    "average": "AVG",
    "min": "MIN",
    "max": "MAX",
    "count": "COUNT",
}

# Mirrors the rig HMI's Data tab, logged once a second: Date + Time (merged
# into `timestamp`, UTC), T-101 [C], P-101 [barg], pH-101 [-], CO2 [ppm], Mode.
# The rig logs no level, so there is no level column.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS sensor_readings (
    timestamp      TEXT NOT NULL,
    device_id      TEXT NOT NULL DEFAULT 'mini-co2-rig-01',
    -- No CHECK: a mode the rig adds later is stored, not a dropped row.
    mode           TEXT,
    temp_c         REAL,
    pressure_barg  REAL,
    ph             REAL,
    co2_ppm        REAL,
    -- Per rig: two rigs logging the same second are two rows.
    PRIMARY KEY (device_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON sensor_readings(timestamp);
CREATE INDEX IF NOT EXISTS idx_readings_mode      ON sensor_readings(mode);
"""


@contextmanager
def connect_ro() -> Iterator[sqlite3.Connection]:
    """Read-only connection. Any write raises `sqlite3.OperationalError`."""
    ensure_dirs()
    if not SENSOR_DB.exists():
        raise FileNotFoundError(
            f"sensor database not found at {SENSOR_DB}. "
            "Run the SCADA ingestion subsystem, or seed a demo set for development"
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


def seed_demo(hours: int = 6, interval_s: int = 1) -> int:
    """Generate a plausible run so the UI has something to query offline.

    Not a simulator — just enough shape (a diurnal drift plus one injected CO₂
    excursion) to exercise live and trend queries.
    """
    init_schema()
    with _connect_rw() as conn:
        existing = conn.execute("SELECT COUNT(*) AS n FROM sensor_readings").fetchone()["n"]
        if existing:
            return 0

        now = datetime.now(timezone.utc).replace(microsecond=0)
        start = now - timedelta(hours=hours)
        rows: list[tuple[Any, ...]] = []
        device = device_id()
        steps = int(hours * 3600 / interval_s)
        # One CO₂ excursion, roughly two-thirds of the way through.
        excursion_at = int(steps * 0.66)
        excursion_len = int(300 / interval_s)

        for i in range(steps):
            ts = start + timedelta(seconds=i * interval_s)
            phase = i / steps
            excursion = excursion_at <= i < excursion_at + excursion_len
            mode = "Absorption" if phase < 0.6 else "Desorption"

            co2 = 400 + 90 * phase + random.uniform(-8, 8)
            if excursion:
                co2 += 480 + random.uniform(-30, 30)

            rows.append((
                ts.isoformat(),
                device,
                mode,
                round(28 + 4 * phase + random.uniform(-0.4, 0.4), 2),
                round(1.5 + 0.3 * phase + random.uniform(-0.03, 0.03), 3),
                round(7.0 - 0.35 * phase + random.uniform(-0.05, 0.05), 2),
                round(co2, 1),
            ))

        conn.executemany(
            "INSERT OR IGNORE INTO sensor_readings "
            "(timestamp, device_id, mode, temp_c, pressure_barg, ph, co2_ppm) "
            "VALUES (?,?,?,?,?,?,?)",
            rows,
        )
        return len(rows)


_READINGS = ("temp_c", "pressure_barg", "ph", "co2_ppm")


def ingest(rows: list[dict[str, Any]], device: str) -> dict[str, int]:
    """Store rows from the rig link. Returns how many were new, already
    stored (same device and second, e.g. a resent batch) and skipped as all-zero.

    All four readings at exactly 0 is MainUI logging before a port was
    connected (its buffers start as zeros), not a measurement.
    """
    real = [r for r in rows if any(r.get(k) for k in _READINGS)]
    init_schema()
    with _connect_rw() as conn:
        before = conn.total_changes
        conn.executemany(
            "INSERT OR IGNORE INTO sensor_readings "
            "(timestamp, device_id, mode, temp_c, pressure_barg, ph, co2_ppm) "
            "VALUES (?,?,?,?,?,?,?)",
            [(r["timestamp"], device, r.get("mode"), *(r.get(k) for k in _READINGS)) for r in real],
        )
        inserted = conn.total_changes - before
    return {"inserted": inserted, "duplicates": len(real) - inserted, "skipped_zero": len(rows) - len(real)}


def stats() -> dict[str, Any]:
    """Row counts and coverage window — for Settings → System → Storage health."""
    if not SENSOR_DB.exists():
        return {"exists": False, "rows": 0, "earliest": None, "latest": None}
    with connect_ro() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n, MIN(timestamp) AS earliest, MAX(timestamp) AS latest "
            "FROM sensor_readings"
        ).fetchone()
        today = datetime.now(timezone.utc).date().isoformat()
        rows_today = conn.execute(
            "SELECT COUNT(*) AS n FROM sensor_readings WHERE timestamp >= ?", (today,)
        ).fetchone()["n"]
        return {
            "exists": True,
            "rows": row["n"],
            "earliest": row["earliest"],
            "latest": row["latest"],
            "rows_today": rows_today,
        }
