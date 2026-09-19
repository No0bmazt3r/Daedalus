"""Labyrinth Blueprints — the knowledge map (`MODULES.md` §3).

Two halves, one question: *what does this system actually know, and how is it
connected?*

* **The graph** (Layer 5, Track 2) — served from the hand-authored
  `knowledge_graph.yaml` via `services/knowledge_graph.py`. Built.
* **The corpus** (Layer 4) — ingested documents and their chunks. **Blocked on
  M2.** Those endpoints answer honestly rather than plausibly; see below.

## Read-only, and not reachable from the chat path

`MODULES.md` §0: all three glass-box modules are read-only windows onto work the
system has already done. None of them can send a query. So there is deliberately
no "run a traversal" endpoint here — traversal replay renders a walk that was
*recorded*, and an endpoint that performed one on demand would make this module a
second retrieval path with none of Layer 10's logging.

## Honest empty states

`MODULES.md` §0 rule 4: a module whose data does not exist yet must say *why*
rather than render a plausible-looking empty view. Every endpoint blocked on an
unbuilt milestone therefore returns `available: false` and a `blocked_by` naming
the milestone, and the UI prints that reason. A blank panel that looks broken is
worse than one that explains itself.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ..db import audit_store, paths, sqlite_util
from ..services import graph_seed
from ..services import knowledge_graph as kg

router = APIRouter(prefix="/api", tags=["blueprints"])


# ── the graph half — built ───────────────────────────────────────────────────


@router.get("/graph/schema")
def graph_schema() -> dict[str, Any]:
    """Node and edge types with live counts — drives the Blueprints legend."""
    try:
        return {"available": True, **kg.schema()}
    except kg.GraphValidationError as exc:
        # A graph that does not validate is not served as an empty one: an
        # authoring error must be loud, or it reads as "the graph is empty".
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/graph/nodes")
def graph_nodes(
    q: str | None = Query(default=None, description="Substring match on id, label or alias"),
    type: str | None = Query(default=None, description="Filter to one node type"),
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict[str, Any]:
    """Search and filter the nodes.

    Substring rather than the alias resolver `graph_lookup` uses: this is a
    browsing surface, where "show me everything matching 'sop'" is the useful
    behaviour, and the tool's exact-then-fuzzy precedence is the wrong shape for
    it.
    """
    if type is not None and type not in kg.NODE_TYPES:
        raise HTTPException(status_code=404, detail=f"unknown node type {type!r}")

    try:
        graph = kg.load()
    except kg.GraphValidationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    needle = (q or "").strip().lower()
    rows: list[dict[str, Any]] = []
    for node_id, attrs in graph.nodes(data=True):
        if type and attrs["type"] != type:
            continue
        if needle:
            haystack = " ".join(
                [node_id, str(attrs.get("label", "")), *(attrs.get("aliases") or [])]
            ).lower()
            if needle not in haystack:
                continue
        rows.append({
            "id": node_id,
            **attrs,
            "degree": graph.degree(node_id),
        })

    rows.sort(key=lambda r: (r["type"], r["id"]))
    return {"available": True, "nodes": rows[:limit], "total": len(rows)}


@router.get("/graph/nodes/{node_id:path}")
def graph_node(node_id: str) -> dict[str, Any]:
    """One node with its neighbours, both directions.

    `:path` because node ids contain a colon (`Sensor:co2_ppm`) and carry dates
    (`AnomalyRecord:2026-08-14_co2`); the default converter stops at the slash
    but the colon would otherwise need escaping at every call site.
    """
    try:
        node = kg.node(node_id)
    except kg.GraphValidationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if node is None:
        raise HTTPException(status_code=404, detail=f"no node {node_id!r}")
    return {"available": True, "node": node, **kg.neighbours(node_id)}


@router.get("/graph/coverage")
def graph_coverage() -> dict[str, Any]:
    """What the graph cannot answer, and why.

    `MODULES.md` §3.3 — a hand-authored graph fails by omission, and omission is
    invisible from the answer side. This is the to-do list for graph authoring,
    and the check that makes the dual-track comparison fair rather than assumed.
    """
    try:
        return {"available": True, **kg.coverage().as_dict()}
    except kg.GraphValidationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/graph/traversals")
def graph_traversals(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    """Recent graph-track retrievals, newest first — the replay picker.

    Only `track = 'graph'`: a vector-track row has no walk to replay, and listing
    one here would offer the reader a trace that opens onto an explanation of why
    it cannot be shown.

    `seeded` is carried per row rather than filtered out. Seeds exist so this
    view can be built before the orchestrator writes anything, and hiding the
    marker would be the one way that becomes dishonest — a seeded latency is
    traversal wall-clock only and is not comparable to a measured end-to-end
    figure.
    """
    audit_store.init_db()
    with sqlite_util.connect(paths.AUDIT_DB, read_only=True) as conn:
        rows = conn.execute(
            "SELECT query_id, timestamp, query_text, hop_count, retrieval_latency_ms, "
            "entry_strategy, vector_db_used, traversal_path IS NOT NULL AS replayable "
            "FROM rag_logs WHERE track = 'graph' ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()

    return {
        "available": True,
        "traversals": [
            {
                **{k: v for k, v in dict(r).items() if k != "vector_db_used"},
                "replayable": bool(r["replayable"]),
                "seeded": r["vector_db_used"] == graph_seed.SEED_MARKER,
            }
            for r in rows
        ],
        "total": len(rows),
    }


@router.get("/graph/traversal/{query_id}")
def graph_traversal(query_id: str) -> dict[str, Any]:
    """The walk taken for one query, hop by hop — `MODULES.md` §3.2.

    Read from `rag_logs.traversal_path` (migration 005), never re-derived. Layer
    10 has one source of truth and a module that recomputed a traversal would be
    a second one — and would show the walk the graph *would* take today rather
    than the one that actually produced that answer.
    """
    audit_store.init_db()
    # read_only is the contract, not an optimisation: MODULES.md §0 says these
    # modules read the audit store and never write it, and a connection that
    # cannot write is the cheapest way to keep that true as the file grows.
    with sqlite_util.connect(paths.AUDIT_DB, read_only=True) as conn:
        row = conn.execute(
            "SELECT query_id, timestamp, track, query_text, hop_count, "
            "retrieval_latency_ms, traversal_path, entry_strategy "
            "FROM rag_logs WHERE query_id = ? ORDER BY id DESC LIMIT 1",
            (query_id,),
        ).fetchone()

    if row is None:
        return {
            "available": False,
            "blocked_by": "M5 / M6",
            "reason": (
                f"no retrieval was recorded for {query_id}. Nothing writes rag_logs "
                "yet — the orchestrator is not wired."
            ),
        }

    record = dict(row)
    if record.get("track") != "graph":
        return {
            "available": False,
            "reason": (
                f"{query_id} was answered by the {record.get('track') or 'unknown'} track. "
                "Only graph-track queries have a traversal to replay."
            ),
            "track": record.get("track"),
        }

    raw = record.pop("traversal_path", None)
    if not raw:
        return {
            "available": False,
            "blocked_by": "M6 Track 2",
            "reason": (
                "this trace predates traversal-path recording, so the walk cannot be "
                "replayed. hop_count says how far it went, not where."
            ),
            **record,
        }

    try:
        path = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"corrupt traversal_path: {exc}") from exc

    # Resolve each node id to its current attributes so the replay renders
    # labels rather than ids. A node the graph no longer has is reported as
    # missing rather than dropped — the walk crossed it, and silently omitting
    # it would misrepresent the trace.
    seen: dict[str, Any] = {}
    for hop in path.get("hops", []):
        for node_id in [*hop.get("from", []), *hop.get("to", [])]:
            if node_id not in seen:
                seen[node_id] = kg.node(node_id) or {"id": node_id, "missing": True}

    return {"available": True, **record, "path": path, "nodes": seen}


# ── the corpus half — blocked on M2 ──────────────────────────────────────────

_CORPUS_BLOCKED = {
    "available": False,
    "blocked_by": "M2",
    "reason": (
        "no documents have been ingested, because the ingestion pipeline is not built. "
        "TODO.md:18 — the real corpus (manuals, SOPs, anomaly records, UAUC) blocks M2 entirely."
    ),
    "documents": [],
    "total": 0,
}


@router.get("/corpus/documents")
def corpus_documents() -> dict[str, Any]:
    """Ingested documents with chunk and embedding counts.

    Wired to the honest empty state rather than left unrouted: a 404 here reads
    as a bug in the frontend, and the point of rule 4 is that the panel can
    explain *which milestone* it is waiting on.
    """
    return dict(_CORPUS_BLOCKED)


@router.get("/corpus/documents/{document_id:path}/chunks")
def corpus_chunks(document_id: str) -> dict[str, Any]:
    """Chunks with metadata and the text as the retriever sees it."""
    return {**_CORPUS_BLOCKED, "document_id": document_id, "chunks": []}
