"""Which retrieval track answers a knowledge query — `PROJECT.md` §5.

The dual-track comparison is the project's headline research contribution, and a
comparison needs a switch. This is it: one setting, read on the chat path,
recorded per query in `rag_logs.track`.

## What the switch may and may not change

`PROJECT.md` §5: both tracks share Zones 1/2/4 and every deterministic sensor
tool, and diverge **only** on Path B — troubleshooting, SOP and domain-knowledge
queries. So this setting selects a retrieval strategy for those and touches
nothing else. A live-reading query answers identically under either track,
because a number still comes from a tool (Rule 3), never from retrieval.

Everything else the comparison protocol holds constant — model, quantization,
temperature, corpus, query set, machine — is deliberately *not* configurable
here. A switch that also changed the model would make the two arms differ in two
ways and measure neither.

## Why a file rather than a preference row

Same reasoning as `model_config.json` (§8.1, "never hardcoded"): the evaluation
harness and a scripted run both need an answer when no browser is choosing, and
the value that produced a reported result has to be recoverable afterwards. A
file under version control is legible in a diff and quotable in the report; a
row in `prefs.db` is neither.

## `freeze`, and why it is here

§5's sequencing discipline: *build Track 1 → build Track 2 → freeze both → run
the evaluation once without further tuning.* Tweaking a track after seeing its
results invalidates the comparison — and the failure mode is not malice, it is a
plausible small change made three days before a deadline. `frozen: true` makes
the API refuse writes, so flipping a track mid-evaluation takes a deliberate
hand edit of a committed file rather than a click nobody remembers making.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any, Literal

from ..db import paths

Track = Literal["vector", "graph"]

TRACKS: tuple[Track, ...] = ("vector", "graph")

# `paths.CONFIG_DIR` rather than a cwd-relative path: the dev servers run from
# the repo root and the container from /app, and a relative path resolves to a
# different file in each — which is how a setting silently stops being the one
# the chat path reads.
CONFIG_PATH = paths.CONFIG_DIR / "rag_config.json"

# Vector is the default because it is the control arm. PROJECT.md §5 calls Track
# 1 the baseline, and a comparison whose default is the experimental arm reports
# the experiment as if it were the status quo.
DEFAULT: dict[str, Any] = {
    "track": "vector",
    "frozen": False,
    "note": "Track 1 (vector) is the baseline/control arm — see PROJECT.md §5.",
}

_lock = threading.Lock()


class ConfigFrozen(Exception):
    """The comparison has been frozen; the track may not be changed via the API."""


def read() -> dict[str, Any]:
    """The current setting, falling back to the default rather than failing.

    A missing or unreadable config must not take the chat path down — it means
    "nobody has chosen", and the baseline is the right answer to that.
    """
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT)

    track = raw.get("track")
    if track not in TRACKS:
        return dict(DEFAULT)
    return {
        "track": track,
        "frozen": bool(raw.get("frozen", False)),
        "note": raw.get("note", DEFAULT["note"]),
    }


def write(track: Track, *, note: str | None = None) -> dict[str, Any]:
    """Commit a track choice. Refuses while frozen."""
    if track not in TRACKS:
        raise ValueError(f"unknown track {track!r}; expected one of {TRACKS}")

    with _lock:
        current = read()
        if current["frozen"]:
            raise ConfigFrozen(
                "the comparison is frozen — edit config/rag_config.json by hand to change it. "
                "PROJECT.md §5: tuning a track after seeing its results invalidates the comparison."
            )
        payload = {
            "track": track,
            "frozen": False,
            "note": note or current.get("note") or DEFAULT["note"],
        }
        # Written the same way `model_config` writes: temp file, fsync, atomic
        # rename. This is read on the chat path, and a half-written config read
        # mid-query would fall back to the baseline without saying so.
        paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=paths.CONFIG_DIR, prefix=".rag_config-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, CONFIG_PATH)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        return payload


def resolve() -> Track:
    """The track a Path B query should use. The one call the chat path needs."""
    return read()["track"]  # type: ignore[return-value]


def status() -> dict[str, Any]:
    """The setting plus whether each track can actually answer right now.

    Both tracks are configurable before either is built, and a switch that
    silently selects an unbuilt track is worse than one that says so. The
    readiness flags are computed rather than declared: the graph track is ready
    when the graph loads, the vector track when the collection has chunks.
    """
    from . import knowledge_graph as kg  # noqa: PLC0415 — avoids a boot-time import cycle

    graph_ready, graph_detail = False, ""
    try:
        info = kg.schema()
        graph_ready = info["total_nodes"] > 0
        graph_detail = f"{info['total_nodes']} nodes, {info['total_edges']} edges"
    except Exception as exc:  # noqa: BLE001 — a broken graph is "not ready", not a 500
        graph_detail = str(exc)

    vector_ready, vector_detail = False, "ingestion is not built (M2)"
    try:
        from ..db import vector_store  # noqa: PLC0415

        health = vector_store.stats()
        documents = health.get("documents") or 0
        # Reachable and empty is a different problem from unreachable, and the
        # panel has to distinguish them: one waits on M2, the other on Chroma
        # not running — which `./daedalus.sh dev` does not start.
        if not health.get("available"):
            vector_detail = str(health.get("error") or "chroma unreachable")
        elif documents:
            vector_ready = True
            vector_detail = f"{documents} chunks in {health.get('collection')}"
        else:
            vector_detail = f"reachable ({health.get('mode')} mode), no chunks ingested yet"
    except Exception as exc:  # noqa: BLE001
        vector_detail = str(exc)

    return {
        **read(),
        "tracks": [
            {
                "id": "vector",
                "label": "Traditional vector RAG",
                "role": "baseline / control",
                "ready": vector_ready,
                "detail": vector_detail,
                "blocked_by": None if vector_ready else "M2",
            },
            {
                "id": "graph",
                "label": "Agentic GraphRAG",
                "role": "comparison arm",
                "ready": graph_ready,
                "detail": graph_detail,
                "blocked_by": None if graph_ready else "M6 Track 2",
            },
        ],
    }
