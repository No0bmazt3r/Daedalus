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

## Re-ranking is Track 1's, and lives here for the same reason

Whether Track 1 re-scores its candidates with a cross-encoder (`reranker`), with
which model, and how wide the candidate pool is, all change what Track 1
retrieves — they are part of the arm being compared. So they sit in this file,
are recorded per query in `rag_logs.rerank_model`, and are frozen with the
track: a re-ranker switched on after seeing Track 1's scores is exactly the
tuning §5 forbids.

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
# How many chunks Chroma returns for the cross-encoder to choose `top_k` from.
# Wide enough to recover a relevant chunk vector search ranked 15th; narrow
# enough that re-scoring stays in the tens of milliseconds on a CPU.
DEFAULT_CANDIDATES = 20
CANDIDATE_RANGE = (5, 50)

# Track 2's two retrieval modes. `agent` lets the local model choose each hop
# (`graph_agent`); `walk` is the fixed path it is measured against inside the
# track (`graph_walk`). The budget bounds the whole loop, model calls included:
# past it the agent answers from what it has gathered. Four steps is the most
# the schema's longest chain (Sensor → Threshold → AnomalyType → SOP → steps)
# needs, so a fifth could only revisit.
GRAPH_MODES = ("agent", "walk")
BUDGET_RANGE = (1.0, 30.0)
STEPS_RANGE = (1, 4)

DEFAULT: dict[str, Any] = {
    "track": "vector",
    "frozen": False,
    "note": "Track 1 (vector) is the baseline/control arm — see PROJECT.md §5.",
    "rerank": {"enabled": True, "model": "ms-marco-minilm-l6", "candidates": DEFAULT_CANDIDATES},
    "graph": {"mode": "agent", "budget_s": 6.0, "max_steps": 4},
}


def _graph(raw: Any) -> dict[str, Any]:
    out = dict(DEFAULT["graph"])
    if not isinstance(raw, dict):
        return out
    if raw.get("mode") in GRAPH_MODES:
        out["mode"] = raw["mode"]
    b = raw.get("budget_s")
    if isinstance(b, (int, float)) and not isinstance(b, bool) and BUDGET_RANGE[0] <= b <= BUDGET_RANGE[1]:
        out["budget_s"] = float(b)
    n = raw.get("max_steps")
    if isinstance(n, int) and not isinstance(n, bool) and STEPS_RANGE[0] <= n <= STEPS_RANGE[1]:
        out["max_steps"] = n
    return out


def _rerank(raw: Any) -> dict[str, Any]:
    from . import reranker  # noqa: PLC0415 — keeps this module importable without it

    out = dict(DEFAULT["rerank"])
    if not isinstance(raw, dict):
        return out
    if isinstance(raw.get("enabled"), bool):
        out["enabled"] = raw["enabled"]
    if raw.get("model") in reranker.CATALOGUE:
        out["model"] = raw["model"]
    n = raw.get("candidates")
    if isinstance(n, int) and not isinstance(n, bool) and CANDIDATE_RANGE[0] <= n <= CANDIDATE_RANGE[1]:
        out["candidates"] = n
    return out

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
        return {**DEFAULT, "rerank": _rerank(None), "graph": _graph(None)}

    track = raw.get("track")
    if track not in TRACKS:
        valid = isinstance(raw, dict)
        return {
            **DEFAULT,
            "rerank": _rerank(raw.get("rerank") if valid else None),
            "graph": _graph(raw.get("graph") if valid else None),
        }
    return {
        "track": track,
        "frozen": bool(raw.get("frozen", False)),
        "note": raw.get("note", DEFAULT["note"]),
        "rerank": _rerank(raw.get("rerank")),
        "graph": _graph(raw.get("graph")),
    }


def write(
    track: Track | None = None,
    *,
    note: str | None = None,
    rerank: dict[str, Any] | None = None,
    graph: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Commit a track choice, Track 1's re-ranking and/or Track 2's retrieval mode.

    Refuses while frozen.
    """
    if track is not None and track not in TRACKS:
        raise ValueError(f"unknown track {track!r}; expected one of {TRACKS}")
    if rerank is not None:
        _validate_rerank(rerank)
    if graph is not None:
        _validate_graph(graph)

    with _lock:
        current = read()
        if current["frozen"]:
            raise ConfigFrozen(
                "the comparison is frozen — edit config/rag_config.json by hand to change it. "
                "PROJECT.md §5: tuning a track after seeing its results invalidates the comparison."
            )
        payload = {
            "track": track or current["track"],
            "frozen": False,
            "note": note or current.get("note") or DEFAULT["note"],
            "rerank": _rerank({**current["rerank"], **(rerank or {})}),
            "graph": _graph({**current["graph"], **(graph or {})}),
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


def _validate_rerank(raw: dict[str, Any]) -> None:
    from . import reranker  # noqa: PLC0415

    if "enabled" in raw and not isinstance(raw["enabled"], bool):
        raise ValueError("rerank.enabled must be true or false")
    if "model" in raw and raw["model"] not in reranker.CATALOGUE:
        raise ValueError(f"unknown re-ranker {raw['model']!r}; expected one of {sorted(reranker.CATALOGUE)}")
    if "candidates" in raw:
        n = raw["candidates"]
        low, high = CANDIDATE_RANGE
        if not isinstance(n, int) or isinstance(n, bool) or not low <= n <= high:
            raise ValueError(f"rerank.candidates must be a whole number from {low} to {high}")


def _validate_graph(raw: dict[str, Any]) -> None:
    if "mode" in raw and raw["mode"] not in GRAPH_MODES:
        raise ValueError(f"graph.mode must be one of {GRAPH_MODES}")
    if "budget_s" in raw:
        b = raw["budget_s"]
        low, high = BUDGET_RANGE
        if not isinstance(b, (int, float)) or isinstance(b, bool) or not low <= b <= high:
            raise ValueError(f"graph.budget_s must be a number of seconds from {low:g} to {high:g}")
    if "max_steps" in raw:
        n = raw["max_steps"]
        low, high = STEPS_RANGE
        if not isinstance(n, int) or isinstance(n, bool) or not low <= n <= high:
            raise ValueError(f"graph.max_steps must be a whole number from {low} to {high}")


def graph_settings() -> dict[str, Any]:
    """Track 2's retrieval mode, budget and step limit, read on every query."""
    return read()["graph"]


def rerank_settings() -> dict[str, Any]:
    """Track 1's re-ranking, as the search tool reads it on every query."""
    return read()["rerank"]


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

    # What is actually standing between this arm and answering a question.
    #
    # This used to report `blocked_by: "M2"` whenever the arm was not ready,
    # which stopped being true the moment ingestion was built: an empty corpus
    # is not a missing milestone, it is a corpus with nothing in it, and the two
    # have completely different fixes. Telling somebody to wait for M2 when the
    # answer is "import a document" is worse than saying nothing — it names a
    # blocker they cannot act on and hides the one they can.
    #
    # So the blocker is computed from the pipeline's own state, in the order the
    # pipeline runs: no documents → nothing chunked → nothing embedded → a
    # mismatched index. Each step is the thing you would do next.
    vector_ready, vector_detail, vector_blocker = False, "the corpus could not be read", None
    try:
        from ..db import corpus_store, vector_store  # noqa: PLC0415

        from . import embedding_models  # noqa: PLC0415

        health = vector_store.stats()
        index = embedding_models.index_state()
        corpus = corpus_store.stats()

        # Ready means "can answer this query", which is stricter than "has rows
        # in it". An index built by a different embedding model, or by something
        # that never recorded itself, is refused by the query path — so this arm
        # is not ready either, and saying otherwise would put a track into the
        # comparison that cannot run.
        vector_ready = index["index_state"] == "current"
        vector_detail = index["index_detail"]

        if vector_ready:
            vector_blocker = None
        elif not corpus.get("available"):
            vector_blocker = "the corpus store"
            vector_detail = corpus.get("error") or "the corpus manifest could not be opened"
        elif not corpus.get("documents"):
            vector_blocker = "documents"
            vector_detail = (
                "the corpus is empty — import documents in Blueprints → Corpus"
            )
        elif not corpus.get("chunks"):
            vector_blocker = "an ingest run"
            vector_detail = (
                f"{corpus['documents']} document(s) imported but never chunked — "
                "run the pipeline in Blueprints → Corpus"
            )
        elif not corpus.get("embedded"):
            vector_blocker = "embedding"
            vector_detail = (
                f"{corpus['chunks']} chunks written, none embedded · {index['index_detail']}"
            )
        else:
            # Chunks, vectors, and still not ready: the index exists but the
            # query path will refuse it. `index_detail` is the only thing here
            # that knows why, and it is the actionable half.
            vector_blocker = "a matching index"

        # Reachable and empty stays distinguishable from unreachable: one is a
        # corpus nobody has filled, the other is Chroma not running — which
        # `./daedalus.sh dev` does start, but a bare uvicorn does not.
        if index["index_state"] == "empty" and not health.get("available"):
            vector_detail = f"the vector store is unreachable · {vector_detail}"
    except Exception as exc:  # noqa: BLE001
        vector_detail = str(exc)
        vector_blocker = "the corpus store"

    from . import reranker  # noqa: PLC0415

    runtime_ok, runtime_detail = reranker.runtime_available()
    return {
        **read(),
        "rerankers": reranker.models(),
        "rerank_fit": reranker.fit_summary(),
        "rerank_runtime": {"available": runtime_ok, "detail": runtime_detail},
        "tracks": [
            {
                "id": "vector",
                "label": "Traditional vector RAG",
                "role": "baseline / control",
                "ready": vector_ready,
                "detail": vector_detail,
                "blocked_by": vector_blocker,
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
