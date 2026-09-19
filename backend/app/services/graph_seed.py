"""Seed `rag_logs` with real graph traversals — development only.

`MODULES.md` §1.2 endorses this shape: build the viewer now against a seeder
that produces realistic traces, the same way `POST /api/system/seed-demo` seeds
sensor telemetry, so the orchestrator lands into a surface that can already
inspect it. Traversal replay is `MODULES.md` §3.2's headline feature and it
cannot be built, demoed or reviewed against an empty table.

## These are recorded walks, not fabricated ones

The obvious shortcut is to write plausible-looking JSON straight into
`traversal_path`. This does not: each query below is put through the real
`graph_query_natural` and `graph_traverse`, and what gets stored is what those
actually did against the authored graph.

That distinction matters twice. A hand-written path would drift the moment the
YAML changed, so the viewer would be developed against a shape the tools no
longer produce. And a seeded row is indistinguishable from an orchestrator row
by construction — when M6 lands and starts writing real traffic, the viewer
needs no change, because it was never reading anything else.

What is *not* real here is the surrounding query: there was no user, no model
and no answer. So every seeded row is marked `vector_db_used = 'seed'`, which is
how the Thread, the evaluation harness and any latency table can exclude them.
Seeded latency is wall-clock time for the traversal alone and is not comparable
to a measured end-to-end figure.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from ..db import paths, sqlite_util
from . import graph_tools as gt

SEED_MARKER = "seed"

# Query, then the walk to run for it: (relationship, reverse, sufficiency note).
# Stratified the way `PROJECT.md` §5 stratifies the evaluation set, so the viewer
# is exercised against every shape it has to render rather than one happy path:
# a multi-hop causal walk, a single-hop lookup, a dead end, and a refusal.
_SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "multi-hop causal",
        "query": "pressure and temperature both spiked — what do I do, and has this happened before?",
        "walk": [
            ("HAS_THRESHOLD", False, (False, "thresholds found, no procedure yet")),
            ("TRIGGERS", False, (False, "anomaly type identified, need the procedure and the history")),
            ("RESOLVED_BY", False, (False, "procedure found, history still missing")),
            ("INSTANCE_OF", True, (True, "procedure and history both present")),
        ],
    },
    {
        "id": "single-hop procedural",
        "query": "what are the steps in the emergency cooldown procedure?",
        "walk": [
            ("CONTAINS", False, (True, "all steps of the named procedure retrieved")),
        ],
    },
    {
        "id": "multi-hop, unresolved",
        "query": "the solvent level is running low, what is the procedure?",
        "walk": [
            ("HAS_THRESHOLD", False, (False, "threshold found, no procedure yet")),
            ("TRIGGERS", False, (False, "anomaly type found, still no procedure")),
            # Ends on a genuine gap: AnomalyType:low_solvent_inventory has no
            # RESOLVED_BY edge. The dead end is the point — this is the trace
            # that shows what a coverage gap costs at answer time.
            ("RESOLVED_BY", False, (False, "no resolving SOP authored for this anomaly type")),
        ],
    },
    {
        "id": "out-of-corpus refusal",
        "query": "what is the radiation shielding thickness on the vessel?",
        "walk": [],
    },
]


def _write(conn: Any, *, query_id: str, ts: str, scenario: dict[str, Any]) -> None:
    path = gt.TraversalPath(entry_query=scenario["query"])
    entries, strategy = gt.graph_query_natural(scenario["query"])
    path.entry_strategy = strategy
    path.entry_nodes = [n["id"] for n in entries]

    sub = gt.Subgraph()
    for node in entries:
        sub.add_node(node["id"])

    frontier = list(path.entry_nodes)
    for relationship, reverse, (sufficient, reason) in scenario["walk"]:
        if not frontier:
            break
        # The history hop reads from every AnomalyType gathered so far, not from
        # the SOP documents the previous hop reached — a frontier is not always
        # the right starting set, and hard-coding it here keeps the tools honest.
        start = (
            [n["id"] for n in sub.of_type("AnomalyType")]
            if relationship == "INSTANCE_OF"
            else frontier
        )
        sub = gt.graph_traverse(start, relationship, subgraph=sub, path=path, reverse=reverse)
        path.mark(sufficient, reason)
        frontier = sub.frontier

    conn.execute(
        "INSERT INTO rag_logs (query_id, timestamp, track, vector_db_used, query_text, "
        "top_k, retrieved_chunk_ids, retrieval_scores, source_files, hop_count, "
        "retrieval_latency_ms, traversal_path, entry_strategy) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            query_id,
            ts,
            "graph",
            SEED_MARKER,
            scenario["query"],
            None,
            json.dumps(sorted(sub.nodes)),
            None,
            json.dumps(sorted({
                n["filename"] for n in sub.of_type("SOPDocument") if n.get("filename")
            })),
            path.hop_count,
            path.elapsed_ms,
            json.dumps(path.as_dict()),
            path.entry_strategy,
        ),
    )


def seed(force: bool = False) -> dict[str, Any]:
    """Write one `rag_logs` row per scenario. Refuses if seeds already exist.

    Refusing by default matches `sensor_store.seed_demo`: a seeder that silently
    doubles its own output every time somebody clicks the button turns a demo
    into a data-quality problem.
    """
    with sqlite_util.connect(paths.AUDIT_DB) as conn:
        existing = conn.execute(
            "SELECT COUNT(*) FROM rag_logs WHERE vector_db_used = ?", (SEED_MARKER,)
        ).fetchone()[0]
        if existing and not force:
            return {"seeded": 0, "existing": existing, "note": "already seeded — nothing written"}
        if force:
            conn.execute("DELETE FROM rag_logs WHERE vector_db_used = ?", (SEED_MARKER,))

        now = datetime.now(timezone.utc).replace(microsecond=0)
        written: list[dict[str, str]] = []
        for i, scenario in enumerate(_SCENARIOS):
            ts = (now - timedelta(minutes=7 * (len(_SCENARIOS) - i))).isoformat()
            query_id = f"seed_{ts[:10].replace('-', '')}_{i:04d}"
            _write(conn, query_id=query_id, ts=ts, scenario=scenario)
            written.append({"query_id": query_id, "scenario": scenario["id"]})

    return {"seeded": len(written), "traces": written}


def clear() -> int:
    """Remove every seeded row, leaving real traces untouched."""
    with sqlite_util.connect(paths.AUDIT_DB) as conn:
        cur = conn.execute("DELETE FROM rag_logs WHERE vector_db_used = ?", (SEED_MARKER,))
        return cur.rowcount
