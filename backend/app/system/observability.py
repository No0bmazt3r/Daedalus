"""The Observability page: how the assistant has been performing, from `ai_logs.db`.

Read-only figures over the audit log, so nothing runs beside the app. A turn is
classified exactly as Ariadne's Thread classifies it (`thread.listing`), so the
two never disagree about what counted as grounded or refused.

Sources come from `model_logs.source`. A turn is `eval` when any of its model
calls was; otherwise `chat`, which includes turns the guard refused (they never
reach a model). Benchmarks call the model directly and have no turns, so under
`benchmark` only the Models table has rows.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone, tzinfo
from typing import Any, Literal

from ..chat import assistant_settings
from ..db import audit_store, sqlite_util
from ..db.paths import AUDIT_DB
from ..thread import thread_settings
from ..thread.listing import _percentile, summary

Range = Literal["24h", "7d", "30d", "all"]
Source = Literal["chat", "eval", "benchmark"]

RANGES: dict[str, timedelta | None] = {
    "24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30), "all": None,
}
MODEL_SOURCES = {"chat": ("chat", "chat_cloud"), "eval": ("eval",), "benchmark": ("benchmark", "benchmark_cloud")}
# Where a turn's time went, in the order the stacked bar draws it.
PHASES = ("retrieval", "rerank", "load", "prefill", "generation")
MAX_POINTS = 60
ERRORS_SHOWN = 20
SLOWEST_SHOWN = 10


def _iso(at: datetime) -> str:
    return at.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _parse(ts: str) -> datetime:
    at = datetime.fromisoformat(ts)
    return at if at.tzinfo else at.replace(tzinfo=timezone.utc)


def _bucket_start(at: datetime, unit: str, zone: tzinfo) -> datetime:
    """The start of the hour, day or week (Monday) `at` falls in, in the site's time zone."""
    local = at.astimezone(zone)
    if unit == "hour":
        return local.replace(minute=0, second=0, microsecond=0)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return day - timedelta(days=day.weekday()) if unit == "week" else day


def _timeline(start: datetime, end: datetime, zone: tzinfo, range_: str) -> tuple[str, list[datetime]]:
    """Every bucket from `start` to `end`, empty ones included, so gaps show as gaps."""
    unit = "hour" if range_ == "24h" else "day"
    if range_ == "all" and (end - start).days > MAX_POINTS:
        unit = "week"
    step = {"hour": timedelta(hours=1), "day": timedelta(days=1), "week": timedelta(weeks=1)}[unit]
    out, at = [], _bucket_start(start, unit, zone)
    while at <= end:
        out.append(at)
        # Step in local wall time, then re-anchor, so a DST change cannot drift the buckets.
        at = _bucket_start(at + step + timedelta(hours=2), unit, zone) if unit != "hour" else at + step
    return unit, out


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def report(range_: str = "all", source: str = "chat") -> dict[str, Any]:
    zone = assistant_settings.site_tz()
    now = datetime.now(timezone.utc)
    span = RANGES[range_]
    since = _iso(now - span) if span else None
    model_sources = MODEL_SOURCES[source]

    audit_store.init_db()
    with sqlite_util.connect(AUDIT_DB, read_only=True) as conn:
        def rows(sql: str, *params: Any) -> list[dict[str, Any]]:
            return [dict(r) for r in conn.execute(sql, params).fetchall()]

        after = "timestamp >= ?" if since else "1 = 1"
        window = (since,) if since else ()
        eval_ids = {r["query_id"] for r in rows("SELECT DISTINCT query_id FROM model_logs WHERE source = 'eval'")}
        rag = {r["query_id"]: r for r in rows(
            f"SELECT query_id, SUM(COALESCE(retrieval_latency_ms, 0)) AS retrieval,"
            f" SUM(COALESCE(rerank_latency_ms, 0)) AS rerank FROM rag_logs WHERE {after} GROUP BY query_id", *window)}
        engine = {r["query_id"]: r for r in rows(
            f"SELECT query_id, SUM(COALESCE(load_ms, 0)) AS load, SUM(COALESCE(prefill_ms, 0)) AS prefill,"
            f" SUM(COALESCE(generation_ms, 0)) AS generation FROM model_logs WHERE {after} GROUP BY query_id",
            *window)}
        tool_rows = rows(f"SELECT query_id, tool_name, status, latency_ms FROM tool_logs WHERE {after}", *window)
        marks = ",".join("?" * len(model_sources))
        model_rows = rows(
            f"SELECT model_name, status, time_to_first_token_ms, completion_token_count, generation_ms,"
            f" total_inference_ms FROM model_logs WHERE {after} AND source IN ({marks})", *window, *model_sources)
        error_rows = rows(
            f"SELECT timestamp, component, error_type, message, query_id FROM error_logs WHERE {after}"
            f" ORDER BY id DESC", *window)

    # ── turns ────────────────────────────────────────────────────────────────
    settings = thread_settings.read()
    labels = audit_store.latest_labels()
    turns = []
    if source != "benchmark":
        for row in audit_store.recent_queries(since=since):
            if (row["query_id"] in eval_ids) == (source == "eval"):
                turns.append(summary(row, None, settings, labels.get(row["query_id"])))
    ids = {t["query_id"] for t in turns}

    latencies = [t["latency_ms"] for t in turns if t["latency_ms"] is not None]
    count = lambda key, value: sum(1 for t in turns if t[key] == value)  # noqa: E731
    labelled = [t for t in turns if t["label"]]
    checked = count("bucket", "grounded") + count("bucket", "ungrounded")
    headline = {
        "turns": len(turns),
        "p50_ms": _percentile(latencies, 50),
        "p95_ms": _percentile(latencies, 95),
        "errors": count("status", "error"),
        "error_rate": _rate(count("status", "error"), len(turns)),
        "refused": count("status", "refused"),
        "refusal_rate": _rate(count("status", "refused"), len(turns)),
        "grounded": count("bucket", "grounded"),
        "checked": checked,
        "grounded_rate": _rate(count("bucket", "grounded"), checked),
        "labelled": len(labelled),
        "hallucinated": sum(1 for t in labelled if t["label"]["hallucinated"]),
        "hallucination_rate": _rate(sum(1 for t in labelled if t["label"]["hallucinated"]), len(labelled)),
    }

    # ── over time ────────────────────────────────────────────────────────────
    series: list[dict[str, Any]] = []
    unit = "hour" if range_ == "24h" else "day"
    if turns:
        first = min(_parse(t["timestamp"]) for t in turns)
        unit, starts = _timeline(now - span if span else first, now, zone, range_)
        grouped: dict[datetime, list[dict[str, Any]]] = {s: [] for s in starts}
        for t in turns:
            grouped.setdefault(_bucket_start(_parse(t["timestamp"]), unit, zone), []).append(t)
        for start in sorted(grouped):
            group = grouped[start]
            lat = [t["latency_ms"] for t in group if t["latency_ms"] is not None]
            point: dict[str, Any] = {"start": start.isoformat(), "turns": len(group),
                                     "p50_ms": _percentile(lat, 50), "p95_ms": _percentile(lat, 95)}
            for phase in PHASES:
                source_row = rag if phase in ("retrieval", "rerank") else engine
                total = sum((source_row.get(t["query_id"]) or {}).get(phase) or 0 for t in group)
                point[phase] = round(total / len(group)) if group else None
            series.append(point)

    # ── tools ────────────────────────────────────────────────────────────────
    by_tool: dict[str, list[dict[str, Any]]] = {}
    for r in tool_rows:
        if r["query_id"] in ids:
            by_tool.setdefault(r["tool_name"], []).append(r)
    tools = sorted((
        {"name": name, "calls": len(calls),
         "failed": sum(1 for c in calls if c["status"] != "ok"),
         "p50_ms": _percentile([c["latency_ms"] for c in calls if c["latency_ms"] is not None], 50),
         "p95_ms": _percentile([c["latency_ms"] for c in calls if c["latency_ms"] is not None], 95)}
        for name, calls in by_tool.items()), key=lambda t: (-t["calls"], t["name"]))

    # ── models ───────────────────────────────────────────────────────────────
    by_model: dict[str, list[dict[str, Any]]] = {}
    for r in model_rows:
        by_model.setdefault(r["model_name"] or "unknown", []).append(r)
    models = []
    for name, calls in by_model.items():
        speeds = [round(c["completion_token_count"] * 1000 / c["generation_ms"])
                  for c in calls if (c["completion_token_count"] or 0) > 0 and (c["generation_ms"] or 0) > 0]
        models.append({
            "name": name, "calls": len(calls),
            "failed": sum(1 for c in calls if c["status"] not in (None, "ok")),
            "ttft_p50_ms": _percentile([c["time_to_first_token_ms"] for c in calls
                                        if c["time_to_first_token_ms"] is not None], 50),
            "tokens_per_s_p50": _percentile(speeds, 50),
            "total_p50_ms": _percentile([c["total_inference_ms"] for c in calls
                                         if c["total_inference_ms"] is not None], 50),
        })
    models.sort(key=lambda m: (-m["calls"], m["name"]))

    # ── errors and slowest turns ─────────────────────────────────────────────
    # An error with no turn (a background job, startup) is the app's, filed under chat.
    errors = [
        {**e, "message": (e["message"] or "")[:300]}
        for e in error_rows
        if ((e["query_id"] in ids) if e["query_id"] else source == "chat")
    ][:ERRORS_SHOWN]
    slowest = sorted((t for t in turns if t["latency_ms"] is not None), key=lambda t: -t["latency_ms"])
    slowest_rows = [{k: t[k] for k in ("query_id", "timestamp", "question", "latency_ms", "status", "model")}
                    for t in slowest[:SLOWEST_SHOWN]]

    return {
        "range": range_, "source": source, "unit": unit, "timezone": str(zone),
        "generated_at": _iso(now), "headline": headline, "series": series,
        "tools": tools, "models": models, "errors": errors, "slowest": slowest_rows,
    }
