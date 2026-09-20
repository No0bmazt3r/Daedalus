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

from fastapi import APIRouter, Body, HTTPException, Query

from ..db import audit_store, paths, sqlite_util
from ..services import graph_seed
from ..services import knowledge_graph as kg
from ..services import graph_authoring, rag_config

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
    page = rows[:limit]

    # Edges among the returned nodes, so the diagram can draw the same set the
    # table lists. Filtered to the page rather than sent whole: a link whose
    # endpoint is not on screen has nothing to attach to, and shipping it would
    # push that filtering into the client where it would be done differently.
    visible = {r["id"] for r in page}
    edges = [
        {"from": src, "type": key, "to": dst}
        for src, dst, key in graph.edges(keys=True)
        if src in visible and dst in visible
    ]

    return {
        "available": True,
        "nodes": page,
        "edges": edges,
        "total": len(rows),
        "total_edges": len(edges),
    }


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


# ── the corpus half ──────────────────────────────────────────────────────────
#
# Was a pair of stubs answering `available: false, blocked_by: M2`. The pipeline
# is built, and it is large enough to own a module: see `api/corpus.py` for
# upload, chunking, embedding, runs and the pipeline log. Nothing corpus-shaped
# is served from here any more, and these two routes are gone rather than left
# as redirects — a route that answers with a different shape than it used to is
# worse than one that 404s, because the client cannot tell it changed.


# ── authoring (Track 2's pipeline) ───────────────────────────────────────────
#
# The graph half's counterpart to `/api/corpus`. Everything here writes, so it is
# a **setup** surface under Rule 5 and is never exposed to the model: a node
# exists because a person authored it, which is the provenance claim that makes
# `search_graph` SYSTEM integrity rather than CORPUS.
#
# The YAML stays the source of truth (MODULES.md §3.4) — these routes validate a
# candidate and rewrite the file, so the graph still reviews in a diff and can
# still be hand-edited. See `services/graph_authoring` for why validation runs
# before the write rather than at the next load.


@router.get("/graph/authoring/status")
def authoring_status() -> dict[str, Any]:
    """Totals, validity, coverage, the schema and recent edits — one call."""
    return graph_authoring.status()


@router.get("/graph/authoring/schema")
def authoring_schema() -> dict[str, Any]:
    """Node types, edge domains and the fields each type carries.

    The editor renders its forms from this. A dropdown built from a second copy
    of the schema in TypeScript would offer edges the validator refuses, and only
    at save time.
    """
    return graph_authoring.schema()


@router.get("/graph/authoring/history")
def authoring_history(
    limit: int = Query(100, ge=1, le=1000),
    only_failures: bool = Query(False, description="Just the refused edits."),
) -> dict[str, Any]:
    """Every edit, including the refused ones — the debugging surface.

    Failures are the point. `Sensor --RESOLVED_BY--> SOPDocument` is plausible
    English and meaningless in this schema, and a history that kept only
    successful edits would omit exactly what somebody is trying to understand.
    """
    return {"edits": graph_authoring.history(limit, only_failures=only_failures)}


@router.post("/graph/authoring/nodes")
def create_node(
    node_type: str = Body(...),
    node_id: str = Body(...),
    attributes: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    try:
        return graph_authoring.create_node(node_type, node_id, attributes)
    except graph_authoring.AuthoringError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.patch("/graph/authoring/nodes/{node_id:path}")
def update_node(node_id: str, attributes: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        return graph_authoring.update_node(node_id, attributes)
    except graph_authoring.AuthoringError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.delete("/graph/authoring/nodes/{node_id:path}")
def delete_node(
    node_id: str,
    cascade: bool = Query(False, description="Remove the node's edges with it."),
) -> dict[str, Any]:
    """Refuses while edges point at the node, unless cascade is set.

    The refusal names the edges. A node removed from under them is the silent
    omission MODULES.md §3.3 is about — traversal stops reaching something and
    the answer just gets worse.
    """
    try:
        return graph_authoring.delete_node(node_id, cascade=cascade)
    except graph_authoring.AuthoringError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/graph/authoring/edges")
def create_edge(
    source: str = Body(...), edge_type: str = Body(...), target: str = Body(...)
) -> dict[str, Any]:
    try:
        return graph_authoring.create_edge(source, edge_type, target)
    except graph_authoring.AuthoringError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.delete("/graph/authoring/edges")
def delete_edge(
    source: str = Query(...), edge_type: str = Query(...), target: str = Query(...)
) -> dict[str, Any]:
    try:
        return graph_authoring.delete_edge(source, edge_type, target)
    except graph_authoring.AuthoringError as exc:
        raise HTTPException(422, str(exc)) from exc


# ── the retrieval track switch ───────────────────────────────────────────────


@router.get("/rag/config")
def rag_track() -> dict[str, Any]:
    """Which track answers a knowledge query, and whether each can.

    Readiness is computed, not declared: a switch that silently selects an
    unbuilt track is worse than one that says the track is not ready.
    """
    return rag_config.status()


@router.put("/rag/config")
def set_rag_track(track: str = Body(..., embed=True)) -> dict[str, Any]:
    """Select a retrieval track.

    Refuses while the comparison is frozen (`PROJECT.md` §5): after the two arms
    are built, the evaluation runs once without further tuning, and unfreezing
    is a deliberate hand edit of a committed file rather than a click.

    Selecting a track that is not ready is allowed. The setting is a statement of
    intent and the panel already reports readiness — refusing here would make the
    switch unusable in exactly the window it is most useful, while Track 1 waits
    on M2 and you want to demonstrate Track 2.
    """
    try:
        return {**rag_config.write(track), **rag_config.status()}
    except rag_config.ConfigFrozen as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
