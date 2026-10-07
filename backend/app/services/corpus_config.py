"""The ingestion settings — how documents get split, committed to a file.

Same shape and the same reasoning as `rag_config` and `model_config`: a
committed JSON file rather than a preference row, because the evaluation harness
and a scripted re-ingest both need an answer when no browser is choosing, and
the settings that produced a reported index have to be recoverable afterwards. A
file is legible in a diff and quotable in the report; a row in `prefs.db` is
neither.

## What is here and what is not

Chunk strategy, size and overlap. **Not** the embedding model — that lives in
`embedding_config.json` and is chosen in the Forge, because it is a model and
the Forge is the model console. The two are read together at ingest and both are
copied onto the run row, so a run records the full recipe even after either file
changes.

## Changing these does not change the index

Nothing here is retroactive. Chunks already written keep the boundaries they
were written with, and the corpus panel says so: re-chunking is an explicit run,
not a side effect of moving a slider. The alternative — re-chunking on save —
would make adjusting a number to see its effect the most expensive thing in the
panel.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

from ..db import paths
from . import chunking

CONFIG_PATH = paths.CONFIG_DIR / "corpus_config.json"

DEFAULT: dict[str, Any] = {
    "strategy": chunking.DEFAULT_STRATEGY,
    "chunk_size": chunking.DEFAULT_CHUNK_SIZE,
    "chunk_overlap": chunking.DEFAULT_OVERLAP,
    "note": "architecture/04 step 4: 300-500 tokens with overlap. Sizes here are characters.",
}

_lock = threading.Lock()


def read() -> dict[str, Any]:
    """The current settings, falling back to the defaults rather than failing.

    An unreadable config means "nobody has chosen", and the documented default is
    the right answer to that — the same call `rag_config.read` makes. Values that
    fail validation are also dropped back to the default rather than raising,
    because this is read on the ingest path and a hand-edited file with a typo
    should not make the pipeline unreachable.
    """
    raw: dict[str, Any] = {}
    try:
        loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            raw = loaded
    except (OSError, json.JSONDecodeError):
        raw = {}

    try:
        size, overlap, strategy = chunking.validate(
            raw.get("chunk_size", DEFAULT["chunk_size"]),
            raw.get("chunk_overlap", DEFAULT["chunk_overlap"]),
            raw.get("strategy", DEFAULT["strategy"]),
        )
    except (chunking.ChunkingError, TypeError, ValueError):
        return dict(DEFAULT)

    return {
        "strategy": strategy,
        "chunk_size": size,
        "chunk_overlap": overlap,
        "note": raw.get("note", DEFAULT["note"]),
    }


def write(*, strategy: str, chunk_size: int, chunk_overlap: int) -> dict[str, Any]:
    """Commit settings. Validated first, so a bad set never reaches the file."""
    size, overlap, strat = chunking.validate(chunk_size, chunk_overlap, strategy)
    payload = {
        "strategy": strat,
        "chunk_size": size,
        "chunk_overlap": overlap,
        "note": DEFAULT["note"],
    }
    with _lock:
        # Temp file, fsync, atomic rename — the same write `model_config` and
        # `rag_config` use. This is read at the start of every ingest, and a
        # half-written file read mid-run would silently fall back to defaults.
        paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=paths.CONFIG_DIR, prefix=".corpus_config-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, CONFIG_PATH)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    return payload


def status() -> dict[str, Any]:
    """Settings plus the knobs' bounds, so the panel renders from one payload."""
    return {**read(), **chunking.describe()}
