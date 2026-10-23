"""Sensor tools — the telemetry of record, and the only source of a number.

Rule 3 says numbers come from tools, never from the model. These two are the
tools it means: `PROJECT.md` §7.2 / `architecture/08` §Tools 1–2. Everything
else in the registry finds *text*; this category finds *values*, and a value in
an answer that did not come from here (or from a cited document) is what the
response validator exists to catch.

## Read-only three times over

1. The store opens `file:…?mode=ro`, so SQLite itself rejects a write.
2. Every statement here is a fixed `SELECT` with `?` placeholders. No argument
   is ever formatted into SQL; the only identifiers that reach a query come out
   of `sensor_store.SENSOR_COLUMNS`, keyed by an enum the registry has already
   checked.
3. The tools declare `READ_SENSOR` and nothing else, so the registry would
   refuse them on the runtime surface if they ever grew a write effect.

## Bounded

§7.2's "query timeout and result-size caps": each query runs under a progress
handler that aborts it past `_QUERY_TIMEOUT_S`; a series is downsampled to at
most `_MAX_SERIES` points by time bucket, not truncated (a truncated series of a
spike can end before the spike). Errors
name what was wrong with the request, never a path or a statement.

## Timestamps

Stored as ISO-8601 UTC with an explicit `+00:00`, which sorts as text. Every
bound is converted to exactly that form before it is compared, so a caller that
passes `2026-09-12 10:00` or `…Z` gets the same rows as one that passes the
canonical form. A timestamp without an offset is read as UTC — the planner
converts an operator's wall-clock time before it gets here.

A historical reading is the **nearest** row within `_NEAREST_TOLERANCE`, not an
exact match. The feed writes every few seconds, so "CO₂ at 10:00" almost never
has a row stamped exactly 10:00:00; the spec's `WHERE timestamp = ?` would
answer "no data" to nearly every real question. The row actually used is
returned with its offset, so the answer can say "at 10:00:03".
"""

from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from ...db import sensor_store
from .registry import Effect, Param, ToolError, register

# Numeric sensors — the ones a statistic means anything for.
NUMERIC_SENSORS = ("temperature", "pressure", "ph", "level", "co2_ppm")
# State sensors — readable, not aggregable (an "average mode" is not a thing).
STATE_SENSORS = ("mode",)
READABLE_SENSORS = NUMERIC_SENSORS + STATE_SENSORS + ("all",)

AGGREGATIONS = ("average", "min", "max", "count", "latest", "first")
MODES = ("Manual", "Absorption", "Desorption")

_QUERY_TIMEOUT_S = 2.0
_MAX_SERIES = 100
_NEAREST_TOLERANCE = timedelta(minutes=5)
# How old the newest row may be before a "live" reading is reported as stale.
STALE_AFTER = timedelta(minutes=2)


# ── helpers ──────────────────────────────────────────────────────────────────


def parse_ts(value: str, name: str) -> datetime:
    """An ISO timestamp as an aware UTC datetime, or a ToolError naming the field."""
    text = value.strip().replace(" ", "T", 1)
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise ToolError(
            f"{name} must be an ISO-8601 timestamp such as 2026-09-12T10:00:00+00:00; got {value!r}"
        ) from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def fmt_ts(value: datetime) -> str:
    """The stored form. Comparing any other spelling as text gives wrong answers."""
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _run(sql: str, params: tuple[Any, ...]) -> list[sqlite3.Row]:
    """One read under a deadline. Any failure becomes a ToolError with no internals."""
    deadline = time.monotonic() + _QUERY_TIMEOUT_S
    try:
        with sensor_store.connect_ro() as conn:
            # Returning non-zero aborts the statement; called every N VM steps.
            conn.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 10_000)
            return conn.execute(sql, params).fetchall()
    except FileNotFoundError:
        raise ToolError("the sensor database is not available on this machine") from None
    except sqlite3.OperationalError as exc:
        if "interrupted" in str(exc):
            raise ToolError(f"the sensor query took longer than {_QUERY_TIMEOUT_S:g}s and was stopped") from None
        raise ToolError("the sensor database could not be read") from None


def _latest_timestamp() -> datetime | None:
    rows = _run("SELECT MAX(timestamp) AS ts FROM sensor_readings", ())
    ts = rows[0]["ts"] if rows else None
    return parse_ts(ts, "timestamp") if ts else None


def _reading(row: sqlite3.Row, sensor: str) -> dict[str, Any]:
    """One row, shaped for the sensor asked about — or every sensor for 'all'."""
    base = {
        "timestamp": row["timestamp"],
        "mode": row["mode"],
    }
    names = NUMERIC_SENSORS if sensor == "all" else (sensor,)
    values: dict[str, Any] = {}
    for name in names:
        if name in STATE_SENSORS:
            continue
        values[name] = {
            "value": row[sensor_store.SENSOR_COLUMNS[name]],
            "unit": sensor_store.SENSOR_UNITS.get(name, ""),
        }
    if sensor in NUMERIC_SENSORS:
        base.update(sensor=sensor, **values[sensor])
    elif sensor == "all":
        base.update(sensor="all", readings=values)
    else:
        base.update(sensor=sensor, value=base[sensor], unit="")
    return base


# ── tools ────────────────────────────────────────────────────────────────────


@register(
    name="get_live_reading",
    category="sensor",
    summary=(
        "The latest reading of a reactor sensor, or the reading nearest a given time. "
        "Use 'all' for every sensor at once. Returns the value, unit, timestamp "
        "and operating mode."
    ),
    effects={Effect.READ_SENSOR},
    params=(
        Param("sensor", str, "Which sensor to read.", required=True, enum=READABLE_SENSORS,
              example="co2_ppm"),
        Param("timestamp", str,
              "ISO-8601 time to read at (UTC unless an offset is given). Omit for the latest.",
              default=None, max_length=40, example="2026-09-12T15:15:00+00:00"),
    ),
)
def get_live_reading(sensor: str, timestamp: str | None) -> dict[str, Any]:
    if timestamp:
        at = parse_ts(timestamp, "timestamp")
        lo, hi = fmt_ts(at - _NEAREST_TOLERANCE), fmt_ts(at + _NEAREST_TOLERANCE)
        # Nearest on either side, by absolute distance. julianday() is exact to
        # well under a second, which is finer than the feed's interval.
        rows = _run(
            "SELECT * FROM sensor_readings WHERE timestamp BETWEEN ? AND ? "
            "ORDER BY ABS(julianday(timestamp) - julianday(?)) LIMIT 1",
            (lo, hi, fmt_ts(at)),
        )
        if not rows:
            return {
                "data": {"sensor": sensor, "requested_timestamp": fmt_ts(at), "found": False},
                "detail": (
                    f"no reading within {int(_NEAREST_TOLERANCE.total_seconds() // 60)} minutes "
                    f"of {fmt_ts(at)}"
                ),
            }
        reading = _reading(rows[0], sensor)
        offset = (parse_ts(rows[0]["timestamp"], "timestamp") - at).total_seconds()
        reading.update(requested_timestamp=fmt_ts(at), offset_seconds=int(offset), found=True)
        return {"data": reading, "detail": f"{sensor} at {reading['timestamp']}"}

    rows = _run("SELECT * FROM sensor_readings ORDER BY timestamp DESC LIMIT 1", ())
    if not rows:
        return {"data": {"sensor": sensor, "found": False}, "detail": "the sensor table is empty"}
    reading = _reading(rows[0], sensor)
    age = datetime.now(timezone.utc) - parse_ts(rows[0]["timestamp"], "timestamp")
    # Stale is a fact about the feed, and the answer must carry it. "CO₂ is 488
    # ppm" said about a row from two weeks ago is a wrong answer that looks right.
    reading.update(found=True, age_seconds=int(age.total_seconds()), stale=age > STALE_AFTER)
    return {
        "data": reading,
        "detail": f"latest {sensor} at {reading['timestamp']}" + (" (STALE)" if reading["stale"] else ""),
    }


def _downsample(rows: list[sqlite3.Row], column: str) -> list[dict[str, Any]]:
    """At most `_MAX_SERIES` points, one per equal-width bucket, keeping each
    bucket's most extreme value so a spike survives the thinning."""
    if len(rows) <= _MAX_SERIES:
        return [{"timestamp": r["timestamp"], "value": r[column]} for r in rows]
    size = len(rows) / _MAX_SERIES
    values = [r[column] for r in rows if r[column] is not None]
    centre = sum(values) / len(values) if values else 0.0
    out = []
    for i in range(_MAX_SERIES):
        bucket = rows[int(i * size): int((i + 1) * size)] or rows[int(i * size): int(i * size) + 1]
        bucket = [r for r in bucket if r[column] is not None]
        if not bucket:
            continue
        pick = max(bucket, key=lambda r: abs(r[column] - centre))
        out.append({"timestamp": pick["timestamp"], "value": pick[column]})
    return out


@register(
    name="get_trend",
    category="sensor",
    summary=(
        "A statistic of one numeric sensor over a time window — average, min, max, "
        "count, first or latest — with the window's summary and a series of at most "
        "100 points."
    ),
    effects={Effect.READ_SENSOR},
    params=(
        Param("sensor", str, "Which numeric sensor.", required=True, enum=NUMERIC_SENSORS,
              example="temperature"),
        Param("start_time", str, "Window start, ISO-8601 (UTC unless an offset is given).",
              required=True, max_length=40, example="2026-09-12T14:00:00+00:00"),
        Param("end_time", str, "Window end, ISO-8601.", required=True, max_length=40,
              example="2026-09-12T16:00:00+00:00"),
        Param("aggregation", str, "The statistic to report.", default="average", enum=AGGREGATIONS),
        Param("mode_filter", str, "Only rows in this operating mode.", default=None, enum=MODES),
        Param("include_series", bool, "Return the (downsampled) series too.", default=True),
    ),
)
def get_trend(
    sensor: str,
    start_time: str,
    end_time: str,
    aggregation: str,
    mode_filter: str | None,
    include_series: bool,
) -> dict[str, Any]:
    start, end = parse_ts(start_time, "start_time"), parse_ts(end_time, "end_time")
    if end <= start:
        raise ToolError("end_time must be after start_time")
    column = sensor_store.SENSOR_COLUMNS[sensor]  # enum-checked; never caller text

    where = "timestamp BETWEEN ? AND ?"
    params: tuple[Any, ...] = (fmt_ts(start), fmt_ts(end))
    if mode_filter:
        where += " AND mode = ?"
        params += (mode_filter,)

    rows = _run(
        f"SELECT timestamp, {column} FROM sensor_readings WHERE {where} ORDER BY timestamp",  # noqa: S608
        params,
    )
    values = [r[column] for r in rows if r[column] is not None]
    unit = sensor_store.SENSOR_UNITS.get(sensor, "")
    data: dict[str, Any] = {
        "sensor": sensor,
        "aggregation": aggregation,
        "unit": unit,
        "start_time": fmt_ts(start),
        "end_time": fmt_ts(end),
        "mode_filter": mode_filter,
        "sample_count": len(values),
    }
    if not values:
        latest = _latest_timestamp()
        data.update(value=None, latest_reading=fmt_ts(latest) if latest else None)
        return {"data": data, "detail": f"no {sensor} readings between {fmt_ts(start)} and {fmt_ts(end)}"}

    summary = {
        "average": round(sum(values) / len(values), 3),
        "min": min(values),
        "max": max(values),
        "first": values[0],
        "latest": values[-1],
        "count": len(values),
    }
    # Where the extremes happened — "when did it peak?" is the next question.
    peak = next(r for r in rows if r[column] == summary["max"])
    trough = next(r for r in rows if r[column] == summary["min"])
    data.update(
        value=summary[aggregation],
        summary=summary,
        max_at=peak["timestamp"],
        min_at=trough["timestamp"],
        first_at=rows[0]["timestamp"],
        latest_at=rows[-1]["timestamp"],
    )
    if include_series:
        data["series"] = _downsample(rows, column)
    return {
        "data": data,
        "detail": f"{aggregation} {sensor} over {len(values)} readings",
    }

