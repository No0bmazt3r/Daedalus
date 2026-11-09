"""Recent runs of the chat background jobs: is it alive, and what happened last.

Settings → Background Jobs reads this. Three jobs run on their own thread after
an answer is stored — chat titles, the rolling summary, the persona scan — and
until now a run that decided to do nothing left no trace at all, so "why did
my chat not get a title?" had no answer short of reading the code.

In memory, the last `KEEP` per job, cleared on restart. Deliberately not an
audit table: this answers an operator's "is it working", not an evaluation
question, and `ai_logs.db` is what the evaluation reads. The durable traces
already exist — summaries in `memory_logs`, failures in `error_logs`.

A job marks its own outcome from inside `run()`: `skip(reason)` for "looked,
nothing to do", `fail(reason)` for a failure that did not raise, `note()` for
what it did and with which model. An exception is a failure on its own.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Final

from ..db.sqlite_util import utc_now
from ..system import live_events

JOBS: Final = ("title", "summary", "persona")
KEEP: Final = 20

_runs: dict[str, deque[dict[str, Any]]] = {job: deque(maxlen=KEEP) for job in JOBS}
_lock = threading.Lock()
# The run this thread is inside, so a job can mark it without passing it around.
_current = threading.local()


def _mark(**fields: Any) -> None:
    entry = getattr(_current, "entry", None)
    if entry is not None:
        with _lock:
            entry.update({k: v for k, v in fields.items() if v is not None})


def skip(reason: str) -> None:
    """This run looked and had nothing to do. Returns None, so `return skip(...)` reads well."""
    _mark(status="skipped", detail=reason)


def fail(reason: str) -> None:
    """This run failed without raising (a model that answered nothing usable)."""
    _mark(status="failed", detail=reason)


def note(detail: str | None = None, *, model: str | None = None) -> None:
    """What this run did, and with which model."""
    _mark(detail=detail, model=model)


@contextmanager
def run(job: str, session_id: str) -> Iterator[None]:
    """Record one run of `job` on `session_id`. Exceptions are recorded and re-raised."""
    entry: dict[str, Any] = {
        "job": job, "session_id": session_id, "status": "running", "started_at": utc_now(),
        "finished_at": None, "duration_ms": None, "model": None, "detail": None,
    }
    with _lock:
        _runs[job].appendleft(entry)
    _current.entry = entry
    live_events.publish("jobs")
    started = time.monotonic()
    try:
        yield
    except Exception as exc:
        _mark(status="failed", detail=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        _current.entry = None
        with _lock:
            if entry["status"] == "running":
                entry["status"] = "done"
            entry["finished_at"] = utc_now()
            entry["duration_ms"] = round((time.monotonic() - started) * 1000)
        live_events.publish("jobs")


def recent() -> dict[str, list[dict[str, Any]]]:
    """Each job's runs, newest first. Copies, so a caller cannot edit the record."""
    with _lock:
        return {job: [dict(e) for e in runs] for job, runs in _runs.items()}
