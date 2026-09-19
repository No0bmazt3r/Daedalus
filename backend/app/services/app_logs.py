"""The process log — written to a file so it can be read back, and tailed.

## Why this exists at all

Daedalus logs to stdout, which in the container stack means `docker logs`. That
is fine until the thing you want to know is *why did that answer fail* and the
only way to find out is a second terminal and a container name. `PROJECT.md`
§9.2 wants the system's own behaviour inspectable from the system; a log you
have to leave the app to read is not.

So the same records go to a rotating file as well, and `tail()` reads them back.
Two handlers, one logger — stdout keeps working exactly as before, which matters
because `./daedalus.sh logs` and every container orchestrator depend on it.

## This is not `ai_logs.db`

The audit store is structured evidence: one row per tool call, per retrieval,
per model invocation, keyed by `query_id` and queried with `trace()`. It answers
*"prove this answer was grounded"*.

This is the operational log — startup, exceptions, an Ollama timeout, a
migration running. It answers *"why is it behaving like that"*. They live in the
same directory and are read by different questions, which is why one is a
database and this is a text file that rotates and can be thrown away.

## Rotation

5 MB per file, three kept. Sized so a week of ordinary running fits and a
runaway exception loop cannot fill a disk — the failure a log file is most
likely to cause is the one where it becomes the problem it was meant to explain.
"""

from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Final

from ..db import paths

LOG_FILE: Final = paths.LOG_DIR / "daedalus.log"

MAX_BYTES: Final = 5 * 1024 * 1024
BACKUP_COUNT: Final = 3

# Fixed and parseable, because `tail()` has to read it back. A prettier format
# that cannot be parsed would make the viewer guess at levels, and a viewer that
# guesses at levels colours an ERROR as INFO eventually.
FORMAT: Final = "%(asctime)s %(levelname)s %(name)s %(message)s"
DATE_FORMAT: Final = "%Y-%m-%d %H:%M:%S"

LEVELS: Final = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")

# `2026-09-19 22:14:03 INFO daedalus.startup message…`
_LINE = re.compile(
    r"^(?P<at>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+"
    r"(?P<level>DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+"
    r"(?P<logger>\S+)\s+"
    r"(?P<message>.*)$"
)

_installed = False


def install() -> None:
    """Add the file handler to the root logger. Idempotent.

    Attaches to the root rather than to a `daedalus.*` logger on purpose:
    uvicorn's own records and any library's warnings are exactly what somebody
    reading this viewer is looking for, and a log that only contains what this
    project remembered to emit is the least useful kind.
    """
    global _installed
    if _installed:
        return

    try:
        paths.LOG_DIR.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            LOG_FILE, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8"
        )
    except OSError:
        # A read-only or missing log directory must not stop the app from
        # booting. The viewer will report that there is nothing to read, which
        # is true and is a better outcome than refusing to start.
        return

    handler.setFormatter(logging.Formatter(FORMAT, DATE_FORMAT))
    handler.setLevel(logging.INFO)

    root = logging.getLogger()
    root.addHandler(handler)
    # Only raise the root level, never lower it: a deployment that asked for
    # DEBUG should keep it.
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)

    _installed = True


def _read_tail(limit_bytes: int) -> list[str]:
    """The last `limit_bytes` of the log, as lines.

    Seeks from the end rather than reading the file. A 5 MB log read in full to
    show 200 lines is the kind of thing that works on a developer's laptop and
    stalls a panel on a machine that has been up for a month.
    """
    try:
        size = LOG_FILE.stat().st_size
    except OSError:
        return []

    try:
        with LOG_FILE.open("r", encoding="utf-8", errors="replace") as handle:
            if size > limit_bytes:
                handle.seek(size - limit_bytes)
                handle.readline()  # discard the partial line the seek landed in
            return handle.read().splitlines()
    except OSError:
        return []


def parse(line: str) -> dict[str, Any]:
    """One line as a record. Unparseable lines are kept, not dropped.

    A traceback is several lines that do not match the format, and they are the
    most useful thing in the file. They come back with `level: null` and the
    viewer renders them as a continuation of the line above.
    """
    match = _LINE.match(line)
    if not match:
        return {"at": None, "level": None, "logger": None, "message": line, "raw": line}
    return {
        "at": match["at"],
        "level": match["level"],
        "logger": match["logger"],
        "message": match["message"],
        "raw": line,
    }


def tail(
    *, limit: int = 200, level: str | None = None, query: str | None = None
) -> dict[str, Any]:
    """The end of the log, filtered.

    Filtering happens here rather than in the browser so that a poll sends a few
    kilobytes instead of the whole tail — the viewer refreshes every few seconds
    and the difference is the difference between a feature and a background load.
    """
    limit = max(1, min(limit, 2000))
    # Roughly 400 bytes a line, with headroom, so the filters have material to
    # work with and still find `limit` matches in a busy log.
    lines = _read_tail(limit_bytes=max(64_000, limit * 400 * 4))

    wanted = (level or "").strip().upper()
    needle = (query or "").strip().lower()

    records: list[dict[str, Any]] = []
    for line in lines:
        record = parse(line)
        if wanted and wanted != "ALL":
            # A continuation line inherits nothing, so it is kept only when no
            # level filter is active — otherwise a traceback would surface with
            # no way to tell which record it belonged to.
            if record["level"] != wanted:
                continue
        if needle and needle not in line.lower():
            continue
        records.append(record)

    truncated = len(records) > limit
    return {
        "path": str(LOG_FILE),
        "exists": LOG_FILE.exists(),
        "lines": records[-limit:],
        "returned": min(len(records), limit),
        "truncated": truncated,
        "levels": list(LEVELS),
    }
