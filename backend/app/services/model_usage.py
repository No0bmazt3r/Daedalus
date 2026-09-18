"""Per-model usage and latency, aggregated from `model_logs`.

Answers the question a model manager actually has: *what have I been running,
how much, and how fast was it?* Everything here is derived from rows the system
already writes, so it costs one query and nothing has to be instrumented.

## Why the percentiles, and not just an average

`PROJECT.md` §9.2 sets the latency target as "< 3s (report mean, p50, p95)". A
mean alone hides the shape: one cold load or one very long evidence pack drags
it somewhere no individual request ever was, and a small model's latency
distribution has a long right tail by nature. p95 is the number that says
whether an operator *ever* waits, which is the thing the target is about.

## Two clocks, kept apart

The same split the benchmark settled on. `ttft_*` and `total_*` are wall clock:
what the caller waited through, and what §9.2 is measured against. `tokens_per_
sec` comes from the engine's own `generation_ms`: what the model costs,
independent of what else the machine was doing. Mixing them understates the
model and overstates the system, which is how the first Forge benchmark
reported a model at less than half its real speed.

## Benchmarks and real traffic in one table

`MODULES.md` §2.3 wants both in `model_logs` so the latency chapter can compare
them. `source` is what tells them apart again, so it is reported per model
rather than summed away.

Three values, and the third is not a variant of the second: `'chat'` is a live
query, `'benchmark'` is a Forge run on this machine, and `'benchmark_cloud'` is
a Forge run against an Ollama cloud tag, which measures ollama.com's hardware.
Averaging the last two together would describe a datacentre as a laptop.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from ..db import audit_store, sqlite_util
from ..db.paths import AUDIT_DB


def _percentile(values: list[float], fraction: float) -> float | None:
    """Nearest-rank percentile. No interpolation, no numpy.

    Nearest-rank rather than linear interpolation because these are measured
    request latencies, and the honest answer to "what is p95" is a request that
    actually happened rather than a weighted average of two that did.
    """
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round(fraction * (len(ordered) - 1))))
    return ordered[index]


def _summary(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"mean": None, "p50": None, "p95": None, "min": None, "max": None}
    return {
        "mean": round(sum(values) / len(values), 1),
        "p50": _percentile(values, 0.50),
        "p95": _percentile(values, 0.95),
        "min": min(values),
        "max": max(values),
    }


def by_model() -> dict[str, dict[str, Any]]:
    """Usage keyed by model name. Empty when nothing has run yet."""
    try:
        audit_store.init_db()
        with sqlite_util.connect(AUDIT_DB) as conn:
            rows = conn.execute(
                """
                SELECT model_name, timestamp, source, status,
                       prompt_token_count, completion_token_count,
                       time_to_first_token_ms, total_inference_ms,
                       prefill_ms, generation_ms
                FROM model_logs
                WHERE model_name IS NOT NULL
                ORDER BY id
                """
            ).fetchall()
    except (sqlite3.Error, Exception):
        # Usage is a nice-to-have on a management screen. A missing or locked
        # audit database must not take the screen down with it.
        return {}

    out: dict[str, dict[str, Any]] = {}
    latencies: dict[str, dict[str, list[float]]] = {}

    for raw in rows:
        row = dict(raw)
        name = row["model_name"]
        entry = out.setdefault(
            name,
            {
                "model_name": name,
                "runs": 0,
                "errors": 0,
                "by_source": {},
                "first_used": None,
                "last_used": None,
                "prompt_tokens": 0,
                "completion_tokens": 0,
            },
        )
        buckets = latencies.setdefault(name, {"ttft": [], "total": [], "tps": []})

        entry["runs"] += 1
        if row["status"] and row["status"] != "ok":
            entry["errors"] += 1
        source = row["source"] or "unknown"
        entry["by_source"][source] = entry["by_source"].get(source, 0) + 1

        stamp = row["timestamp"]
        if stamp:
            if not entry["first_used"]:
                entry["first_used"] = stamp
            entry["last_used"] = stamp

        entry["prompt_tokens"] += row["prompt_token_count"] or 0
        entry["completion_tokens"] += row["completion_token_count"] or 0

        # Failed calls are counted but kept out of the latency figures: a call
        # that errored after 200ms is not evidence the model is fast.
        if row["status"] != "ok":
            continue
        if row["time_to_first_token_ms"] is not None:
            buckets["ttft"].append(float(row["time_to_first_token_ms"]))
        if row["total_inference_ms"] is not None:
            buckets["total"].append(float(row["total_inference_ms"]))
        if row["generation_ms"] and row["completion_token_count"]:
            buckets["tps"].append(
                row["completion_token_count"] / (row["generation_ms"] / 1000.0)
            )

    for name, entry in out.items():
        buckets = latencies[name]
        entry["time_to_first_token_ms"] = _summary(buckets["ttft"])
        entry["total_inference_ms"] = _summary(buckets["total"])
        tps = _summary(buckets["tps"])
        entry["tokens_per_sec"] = {
            k: (round(v, 1) if isinstance(v, (int, float)) else v) for k, v in tps.items()
        }

    return out


def totals() -> dict[str, Any]:
    """One line for the top of the manager: how much has run through here."""
    usage = by_model()
    return {
        "models": len(usage),
        "runs": sum(u["runs"] for u in usage.values()),
        "errors": sum(u["errors"] for u in usage.values()),
        "prompt_tokens": sum(u["prompt_tokens"] for u in usage.values()),
        "completion_tokens": sum(u["completion_tokens"] for u in usage.values()),
    }
