"""A small, deterministic sensor database.

Two hours at one-minute intervals, 2026-09-12 10:00–11:59 UTC, with one CO₂
excursion from 10:30 to 10:34. Every value is a function of the minute, so a test can state
the exact number a tool must return.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from app.db import paths, sensor_store

START = datetime(2026, 9, 12, 10, 0, tzinfo=timezone.utc)
MINUTES = 120
SPIKE = range(30, 35)


def co2(i: int) -> float:
    return 950.0 + i if i in SPIKE else 450.0 + (i % 10) / 10


def temperature(i: int) -> float:
    return round(28.0 + i / 100, 2)


def build() -> None:
    """(Re)create the fixture. Idempotent."""
    if paths.SENSOR_DB.exists():
        paths.SENSOR_DB.unlink()
    sensor_store.init_schema()
    with sensor_store._connect_rw() as conn:  # noqa: SLF001 — dev/test seeding only
        for i in range(MINUTES):
            ts = (START + timedelta(minutes=i)).isoformat()
            conn.execute(
                "INSERT INTO sensor_readings (timestamp, device_id, mode, temp_c, pressure_barg, ph, "
                "level_pct, co2_ppm) VALUES (?,?,?,?,?,?,?,?)",
                (ts, "co2_reactor_01", "Absorption" if i < 60 else "Desorption", temperature(i),
                 1.5, 7.0, 60.0, co2(i)),
            )


def set_track(track: str, graph_mode: str = "walk") -> None:
    """Select a track. Track 2 defaults to the fixed walk here, so no test reaches a
    model by accident; the agent's own tests drive it with a scripted one."""
    (paths.CONFIG_DIR / "rag_config.json").write_text(json.dumps(
        {"track": track, "frozen": False, "graph": {"mode": graph_mode}}
    ))
