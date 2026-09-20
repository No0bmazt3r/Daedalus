"""Building Track 2's knowledge graph from inside the app — MODULES.md §3.

The graph half's counterpart to `ingestion`. Track 1 gets knowledge by ingesting
documents; Track 2 gets it by somebody authoring nodes and edges, and until now
that meant hand-editing `knowledge_graph.yaml` with no feedback until the next
load. This module is the pipeline for that: validate, write, log, reload.

## The YAML stays the source of truth

`MODULES.md` §3.4 chose a git-tracked file over a store, and nothing here
changes that. Every edit is applied by rewriting the file, so the graph still
reviews in a diff, still travels with the repository, and is still editable by
hand — an operator who prefers an editor loses nothing. What they gain is that
an edit made in the app is checked against the schema *before* it lands, rather
than producing a file that fails to load on the next request.

**Which file.** The packaged graph lives under `app/data/graph/`, and
`docker-compose` mounts `app/` read-only — correctly, since the application
source is not something the application should rewrite. So the authored copy
lives in `config/`, beside `model_config.json` and `rag_config.json`: writable in
the container and still version-controlled. The first edit copies the seed
across; before that the seed is served directly, so a fresh checkout has the
full 37-node graph with nothing to set up.

## Validate before write, always

The order matters and it is the whole safety argument. `knowledge_graph._build`
already refuses a graph that does not satisfy the schema, but it refuses it at
*load* — which means a bad hand edit takes Track 2 down until somebody finds it.
Here the candidate graph is built in memory first, and the file is only written
if that build succeeded. A rejected edit leaves the file byte-identical.

That is why every mutation goes through `_apply`: there is exactly one path that
writes, and it cannot be reached without passing validation.

## Refusals are logged as loudly as successes

`graph_edits` records failed edits with their error. An authoring session's most
informative moments are the ones where the schema said no — `Sensor
--RESOLVED_BY--> SOPDocument` is plausible English and meaningless here — and a
history that kept only what worked would omit exactly what somebody debugging
wants to see.

## What this deliberately does not do

No inference, no suggestion, no LLM. A node exists because a person wrote it,
which is the provenance claim that makes `Integrity.SYSTEM` true for
`search_graph`: every node was authored and reviewable. A tool that invented
nodes would quietly demote the whole track to the same standing as an ingested
PDF, and the comparison in §5 would stop being between two retrieval strategies
and start being between two guesses.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from typing import Any

from ..db import paths, sqlite_util
from . import knowledge_graph as kg

# One writer. Two concurrent edits would each build a candidate from the graph
# as it was before the other started, and the second write would silently
# discard the first — a lost update with no error and no trace.
_lock = threading.RLock()

# The key an edge is addressed by. Edges have no id of their own in the YAML, so
# one is derived; it is stable because all three parts are.
def edge_key(source: str, edge_type: str, target: str) -> str:
    return f"{source}|{edge_type}|{target}"


class AuthoringError(ValueError):
    """The edit is invalid, or would make the graph invalid. Nothing was written."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── reading the file as data, not as a graph ────────────────────────────────


def _read_raw() -> dict[str, Any]:
    """The YAML as plain lists, which is what an edit operates on.

    `knowledge_graph.load()` returns a NetworkX graph, and NetworkX is a lossy
    round trip for this purpose — attribute defaults are filled in at build time,
    so writing a loaded graph back out would slowly rewrite the authored file
    with values nobody typed. Edits are applied to the raw document.
    """
    import yaml  # noqa: PLC0415 — see requirements.txt

    # Whichever file is live — the authored copy, or the packaged seed before
    # the first edit. Reading the seed and writing the authored copy is what
    # makes that first edit a copy-on-write rather than a setup step somebody
    # has to know about.
    path = kg.source_path()
    if not path.exists():
        return {"nodes": [], "edges": []}
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    raw.setdefault("nodes", [])
    raw.setdefault("edges", [])
    return raw


def _write_raw(raw: dict[str, Any]) -> None:
    """Atomic write, then drop the loader's cache.

    Temp file and rename, like every other config write here: `knowledge_graph`
    caches on mtime and a partially written file read mid-save would either fail
    to parse or — worse — parse into a graph missing whatever had not been
    flushed.
    """
    import yaml  # noqa: PLC0415

    kg.GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=kg.GRAPH_PATH.parent, prefix=".graph-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            yaml.safe_dump(raw, fh, sort_keys=False, allow_unicode=True, width=100)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, kg.GRAPH_PATH)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    kg.load(force=True)


def _validate(raw: dict[str, Any]) -> tuple[int, int]:
    """Build the candidate and return its totals, or raise with every problem.

    The build is thrown away — it exists to answer "would this load?" The cost is
    one graph construction per edit over tens of nodes, which is microseconds,
    and it buys the guarantee that the file on disk always loads.
    """
    try:
        graph = kg._build(raw)  # noqa: SLF001 — the validator is this module's whole point
    except kg.GraphValidationError as exc:
        raise AuthoringError(str(exc)) from exc
    return graph.number_of_nodes(), graph.number_of_edges()


# ── the log ─────────────────────────────────────────────────────────────────


def _log(
    *, target: str, action: str, element_id: str | None, element_type: str | None,
    before: Any = None, after: Any = None, ok: bool = True, error: str | None = None,
    nodes_after: int | None = None, edges_after: int | None = None, note: str | None = None,
) -> None:
    """One row in the authoring history. Never raises — see `corpus_store.log`."""
    try:
        with sqlite_util.connect(paths.CORPUS_DB) as conn:
            conn.execute(
                """
                INSERT INTO graph_edits (
                    edit_id, at, target, action, element_id, element_type,
                    before_json, after_json, ok, error, nodes_after, edges_after, note
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    f"edit_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f')}",
                    _now(), target, action, element_id, element_type,
                    json.dumps(before, default=str) if before is not None else None,
                    json.dumps(after, default=str) if after is not None else None,
                    1 if ok else 0, error, nodes_after, edges_after, note,
                ),
            )
    except Exception:  # noqa: BLE001 — a logging failure must not fail the edit
        pass


def history(limit: int = 100, *, only_failures: bool = False) -> list[dict[str, Any]]:
    where = "WHERE ok = 0" if only_failures else ""
    try:
        with sqlite_util.connect(paths.CORPUS_DB) as conn:
            rows = conn.execute(
                f"SELECT * FROM graph_edits {where} ORDER BY at DESC, edit_id DESC LIMIT ?",
                (limit,),
            ).fetchall()
    except Exception:  # noqa: BLE001
        return []
    out = []
    for row in rows:
        item = dict(row)
        for key in ("before_json", "after_json"):
            if item.get(key):
                try:
                    item[key] = json.loads(item[key])
                except (ValueError, TypeError):
                    pass
        out.append(item)
    return out


def _apply(
    raw: dict[str, Any], *, target: str, action: str, element_id: str | None,
    element_type: str | None, before: Any, after: Any, note: str | None = None,
) -> dict[str, Any]:
    """Validate, write, log. The only path to disk.

    A failure is logged and re-raised: the caller gets the error and the history
    keeps the attempt, which is the combination that makes an authoring session
    debuggable after the fact rather than only while it is happening.
    """
    try:
        nodes, edges = _validate(raw)
    except AuthoringError as exc:
        _log(
            target=target, action=action, element_id=element_id, element_type=element_type,
            before=before, after=after, ok=False, error=str(exc), note=note,
        )
        raise
    _write_raw(raw)
    _log(
        target=target, action=action, element_id=element_id, element_type=element_type,
        before=before, after=after, ok=True, nodes_after=nodes, edges_after=edges, note=note,
    )
    return {"ok": True, "nodes": nodes, "edges": edges, "element_id": element_id}


# ── nodes ───────────────────────────────────────────────────────────────────


def _node_index(raw: dict[str, Any], node_id: str) -> int | None:
    for index, node in enumerate(raw["nodes"]):
        if node.get("id") == node_id:
            return index
    return None


def create_node(node_type: str, node_id: str, attributes: dict[str, Any] | None = None) -> dict[str, Any]:
    """Add a node. The id is `Type:slug` and is checked, not generated.

    Checked rather than generated because the id is not an implementation
    detail: `Sensor:co2_ppm` is the join to `sensor_readings.co2_ppm`, and a
    generated surrogate would break the one place the graph touches real
    telemetry. An id that does not match its type is refused here rather than
    producing a node that traversal can reach but nothing can join to.
    """
    with _lock:
        if node_type not in kg.NODE_TYPES:
            raise AuthoringError(
                f"unknown node type {node_type!r}; the schema has {', '.join(kg.NODE_TYPES)}"
            )
        node_id = (node_id or "").strip()
        if not node_id:
            raise AuthoringError("a node needs an id")
        if not node_id.startswith(f"{node_type}:"):
            raise AuthoringError(
                f"a {node_type} node's id must start with {node_type}: — got {node_id!r}. "
                "The prefix is what makes an id self-describing in a traversal path."
            )

        raw = _read_raw()
        if _node_index(raw, node_id) is not None:
            raise AuthoringError(f"{node_id} already exists")

        node = {"id": node_id, "type": node_type, **(attributes or {})}
        raw["nodes"].append(node)
        return _apply(
            raw, target="node", action="create", element_id=node_id,
            element_type=node_type, before=None, after=node,
        )


def update_node(node_id: str, attributes: dict[str, Any]) -> dict[str, Any]:
    """Replace a node's attributes. `id` and `type` are not among them.

    Changing either is a different operation — a retype would orphan every edge
    whose domain depended on the old type, and a re-id would break every edge
    pointing at it. Both are delete-and-recreate, which forces the edges to be
    dealt with rather than silently invalidated.
    """
    with _lock:
        raw = _read_raw()
        index = _node_index(raw, node_id)
        if index is None:
            raise AuthoringError(f"no node {node_id!r}")
        if "id" in attributes or "type" in attributes:
            raise AuthoringError(
                "a node's id and type cannot be edited in place — an edge's validity depends "
                "on both. Delete the node and create it again, which makes the edges explicit."
            )

        before = dict(raw["nodes"][index])
        after = {"id": before["id"], "type": before["type"], **attributes}
        raw["nodes"][index] = after
        return _apply(
            raw, target="node", action="update", element_id=node_id,
            element_type=before["type"], before=before, after=after,
        )


def delete_node(node_id: str, *, cascade: bool = False) -> dict[str, Any]:
    """Remove a node. Refuses while edges point at it, unless told to cascade.

    Refusing by default is the important half. A node silently taken out from
    under its edges produces exactly the failure `MODULES.md` §3.3 is about:
    traversal stops reaching something, the answer gets worse, and nothing says
    why. Naming the edges in the refusal turns that into a decision.
    """
    with _lock:
        raw = _read_raw()
        index = _node_index(raw, node_id)
        if index is None:
            raise AuthoringError(f"no node {node_id!r}")

        attached = [
            e for e in raw["edges"] if e.get("from") == node_id or e.get("to") == node_id
        ]
        if attached and not cascade:
            listed = ", ".join(
                f"{e['from']} --{e['type']}--> {e['to']}" for e in attached[:4]
            )
            more = f" (+{len(attached) - 4} more)" if len(attached) > 4 else ""
            raise AuthoringError(
                f"{node_id} still has {len(attached)} edge(s): {listed}{more}. "
                "Delete them first, or pass cascade to remove them with it."
            )

        before = dict(raw["nodes"][index])
        raw["nodes"].pop(index)
        if attached:
            raw["edges"] = [
                e for e in raw["edges"] if e.get("from") != node_id and e.get("to") != node_id
            ]
        return _apply(
            raw, target="node", action="delete", element_id=node_id,
            element_type=before.get("type"), before=before, after=None,
            note=f"cascaded {len(attached)} edge(s)" if attached else None,
        )


# ── edges ───────────────────────────────────────────────────────────────────


def _edge_index(raw: dict[str, Any], source: str, edge_type: str, target: str) -> int | None:
    for index, edge in enumerate(raw["edges"]):
        if (
            edge.get("from") == source
            and edge.get("to") == target
            and edge.get("type") == edge_type
        ):
            return index
    return None


def create_edge(source: str, edge_type: str, target: str) -> dict[str, Any]:
    """Connect two nodes. The domain check is `_validate`'s, not this function's.

    Deliberately not re-checked here. `EDGE_DOMAINS` is enforced in `_build`, and
    a second copy of that rule in this module is a second thing to keep in step —
    the validator already produces the better message, naming what it expected
    and what it got.
    """
    with _lock:
        if edge_type not in kg.EDGE_TYPES:
            raise AuthoringError(
                f"unknown edge type {edge_type!r}; the schema has {', '.join(kg.EDGE_TYPES)}"
            )
        raw = _read_raw()
        if _edge_index(raw, source, edge_type, target) is not None:
            raise AuthoringError(f"{source} --{edge_type}--> {target} already exists")

        edge = {"from": source, "type": edge_type, "to": target}
        raw["edges"].append(edge)
        return _apply(
            raw, target="edge", action="create",
            element_id=edge_key(source, edge_type, target),
            element_type=edge_type, before=None, after=edge,
        )


def delete_edge(source: str, edge_type: str, target: str) -> dict[str, Any]:
    with _lock:
        raw = _read_raw()
        index = _edge_index(raw, source, edge_type, target)
        if index is None:
            raise AuthoringError(f"no edge {source} --{edge_type}--> {target}")
        before = dict(raw["edges"][index])
        raw["edges"].pop(index)
        return _apply(
            raw, target="edge", action="delete",
            element_id=edge_key(source, edge_type, target),
            element_type=edge_type, before=before, after=None,
        )


# ── the authoring surface as a whole ────────────────────────────────────────


def schema() -> dict[str, Any]:
    """Node types, edge types and what may connect to what.

    The editor renders its forms from this rather than restating the schema in
    TypeScript. A dropdown that offers an edge the backend will refuse is a bug
    that only appears at save time, and it appears every time the schema changes.
    """
    return {
        "node_types": [
            {
                "id": node_type,
                "id_prefix": f"{node_type}:",
                "fields": _FIELDS.get(node_type, []),
            }
            for node_type in kg.NODE_TYPES
        ],
        "edge_types": [
            {"id": edge_type, "from": domain[0], "to": domain[1]}
            for edge_type, domain in kg.EDGE_DOMAINS.items()
        ],
    }


# The attributes each node type carries, for the editor to render. Advisory, not
# enforced: the YAML is a free-form mapping by design and an authored node may
# legitimately carry something nobody anticipated. The list is what the form
# offers, not what the validator requires.
_FIELDS: dict[str, list[dict[str, str]]] = {
    "Sensor": [
        {"name": "label", "hint": "Display name"},
        {"name": "column", "hint": "The sensor_readings column — the join to live telemetry"},
        {"name": "unit", "hint": "°C, ppm, bar"},
        {"name": "description", "hint": "What it measures"},
    ],
    "OperatingMode": [
        {"name": "label", "hint": "Display name"},
        {"name": "description", "hint": "When the reactor is in this mode"},
    ],
    "Threshold": [
        {"name": "label", "hint": "Display name"},
        {"name": "operator", "hint": "> < >= <= =="},
        {"name": "value", "hint": "The number it compares against"},
        {"name": "applies_mode", "hint": "OperatingMode id, or blank for all modes"},
    ],
    "SOPDocument": [
        {"name": "label", "hint": "Display name"},
        {"name": "filename", "hint": "Joins to chunk metadata's source_file — must match a real document"},
        {"name": "version", "hint": "Document version"},
    ],
    "SOPStep": [
        {"name": "label", "hint": "Display name"},
        {"name": "step_number", "hint": "Order within the procedure"},
        {"name": "description", "hint": "What to do"},
    ],
    "AnomalyRecord": [
        {"name": "label", "hint": "Display name"},
        {"name": "occurred_at", "hint": "ISO timestamp"},
        {"name": "severity", "hint": "low · medium · high"},
        {"name": "resolution", "hint": "What was done"},
    ],
    "AnomalyType": [
        {"name": "label", "hint": "Display name"},
        {"name": "description", "hint": "What this class of anomaly is"},
    ],
}


def status() -> dict[str, Any]:
    """Graph totals, validity and recent history — the panel's one call."""
    try:
        info = kg.schema()
        valid, problem = True, None
    except kg.GraphValidationError as exc:
        info = {"total_nodes": 0, "total_edges": 0, "nodes": [], "edges": []}
        valid, problem = False, str(exc)

    coverage = {}
    if valid:
        try:
            coverage = kg.coverage().as_dict()
        except Exception as exc:  # noqa: BLE001
            coverage = {"error": str(exc)}

    return {
        "valid": valid,
        "error": problem,
        # The file actually being read, which before the first edit is the
        # packaged seed. Reporting `GRAPH_PATH` unconditionally claimed an
        # authored copy existed whenever one did not — the panel would name a
        # path you could not find on disk.
        "path": str(kg.source_path()),
        "authored": kg.GRAPH_PATH.exists(),
        "seed_path": str(kg.SEED_PATH),
        "totals": {"nodes": info.get("total_nodes", 0), "edges": info.get("total_edges", 0)},
        "by_type": info.get("nodes", []),
        "edges_by_type": info.get("edges", []),
        "coverage": coverage,
        "schema": schema(),
        "recent": history(limit=15),
    }
