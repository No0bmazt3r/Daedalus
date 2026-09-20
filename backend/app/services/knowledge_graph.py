"""Knowledge graph loader and analysis — Track 2's structural layer.

`PROJECT.md` §5 Track 2 and `MODULES.md` §3. The graph is hand-authored in
`app/data/graph/knowledge_graph.yaml`; this module loads it into NetworkX,
validates it against the declared schema, and answers the two questions
Labyrinth Blueprints asks of it: *what is in here*, and *what is missing*.

## Why a file and not a sixth store

`MODULES.md` §3.4 weighed SQLite tables, NetworkX-over-a-file, and an embedded
graph DB, and chose the middle one. The graph is tens of nodes, hand-authored,
and changes by editing rather than by insert — so the file is the authoring
surface, it reviews in a pull request, and the store count stays at five, which
`PROJECT.md` §6.4 spends real effort defending.

The cost of that choice is that the graph is rebuilt at boot rather than queried
in place. At this size that is microseconds, and `load()` caches on file mtime so
editing the YAML during development reloads without a restart.

## Validation is not optional

A typo'd edge type in a hand-authored file is not a crash — it is a *silent
retrieval failure*. The traversal simply never follows the edge, and the answer
is worse with nothing to indicate why. `PROJECT.md` §5 names this as Track 2's
honest risk. So `load()` refuses a graph that does not validate rather than
serving a subtly broken one, and `coverage()` reports the gaps that are
structurally legal but semantically incomplete.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# The graph is read from whichever of these exists, in order.
#
# `SEED_PATH` is the copy that ships with the code. `GRAPH_PATH` is the authored
# copy, in `config/` — the same directory `model_config.json` and
# `rag_config.json` live in, chosen for the same two reasons: it is **writable**
# at runtime, and it is **git-tracked**, so an in-app edit still reviews in a
# diff exactly as MODULES.md §3.4 requires.
#
# The split exists because the packaged copy is not writable where it matters.
# `docker-compose` mounts `app/` read-only — deliberately, since the application
# source is not something the application should edit — while `config/` is
# mounted read/write. Authoring into the source tree worked in a bare `uvicorn`
# and failed in the container, which is the worse of the two ways round: it
# works for whoever built it and breaks for everybody else.
#
# The first edit copies the seed across. Until then the seed is served directly,
# so a fresh checkout has the authored 37-node graph with nothing to set up.
from ..db import paths as _paths  # noqa: E402 — needed for the path below

SEED_PATH = Path(__file__).resolve().parent.parent / "data" / "graph" / "knowledge_graph.yaml"
GRAPH_PATH = _paths.CONFIG_DIR / "knowledge_graph.yaml"


def source_path() -> Path:
    """The file to read: the authored copy if it exists, else the packaged seed."""
    return GRAPH_PATH if GRAPH_PATH.exists() else SEED_PATH

# The schema, from PROJECT.md §5. Anything outside these two sets is rejected.
NODE_TYPES = (
    "Sensor",
    "OperatingMode",
    "Threshold",
    "SOPDocument",
    "SOPStep",
    "AnomalyRecord",
    "AnomalyType",
)

EDGE_TYPES = (
    "MONITORED_IN",
    "HAS_THRESHOLD",
    "TRIGGERS",
    "RESOLVED_BY",
    "CONTAINS",
    "INSTANCE_OF",
    "INVOLVES",
)

# Which node types an edge type is allowed to connect. Declared rather than
# inferred, so that authoring `Sensor --RESOLVED_BY--> SOPDocument` (plausible
# English, meaningless in this schema) is caught at load instead of producing a
# traversal that walks somewhere the agent's prompt never anticipated.
EDGE_DOMAINS: dict[str, tuple[str, str]] = {
    "MONITORED_IN": ("Sensor", "OperatingMode"),
    "HAS_THRESHOLD": ("Sensor", "Threshold"),
    "TRIGGERS": ("Threshold", "AnomalyType"),
    "RESOLVED_BY": ("AnomalyType", "SOPDocument"),
    "CONTAINS": ("SOPDocument", "SOPStep"),
    "INSTANCE_OF": ("AnomalyRecord", "AnomalyType"),
    "INVOLVES": ("AnomalyRecord", "Sensor"),
}


class GraphValidationError(Exception):
    """The authored graph does not satisfy the schema. Refuse to serve it."""


@dataclass
class Coverage:
    """What the graph cannot answer, and why.

    `MODULES.md` §3.3: a hand-authored graph fails by *omission*, and omission is
    invisible from the answer side. This is the structure that makes it visible.
    """

    orphans: list[dict[str, Any]] = field(default_factory=list)
    unresolved_anomaly_types: list[dict[str, Any]] = field(default_factory=list)
    sensors_without_thresholds: list[dict[str, Any]] = field(default_factory=list)
    thresholds_without_triggers: list[dict[str, Any]] = field(default_factory=list)
    empty_sops: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "orphans": self.orphans,
            "unresolved_anomaly_types": self.unresolved_anomaly_types,
            "sensors_without_thresholds": self.sensors_without_thresholds,
            "thresholds_without_triggers": self.thresholds_without_triggers,
            "empty_sops": self.empty_sops,
            "total_gaps": (
                len(self.orphans)
                + len(self.unresolved_anomaly_types)
                + len(self.sensors_without_thresholds)
                + len(self.thresholds_without_triggers)
                + len(self.empty_sops)
            ),
        }


_lock = threading.Lock()
_cache: Any = None
_cache_mtime: float | None = None
_cache_source: Path | None = None


def _build(raw: dict[str, Any]) -> Any:
    """Turn the parsed YAML into a validated MultiDiGraph.

    MultiDiGraph rather than DiGraph: two nodes may legitimately be connected by
    more than one edge type (a Threshold both TRIGGERS an AnomalyType and could
    later carry another relation to it), and collapsing those would lose the edge
    label that traversal replay renders.
    """
    import networkx as nx  # noqa: PLC0415 — heavy-ish import, only when the graph is used

    graph = nx.MultiDiGraph()
    errors: list[str] = []

    for node in raw.get("nodes") or []:
        node_id = node.get("id")
        node_type = node.get("type")
        if not node_id:
            errors.append(f"node with no id: {node!r}")
            continue
        if node_type not in NODE_TYPES:
            errors.append(f"{node_id}: unknown node type {node_type!r}")
            continue
        if graph.has_node(node_id):
            errors.append(f"{node_id}: duplicate node id")
            continue
        attrs = {k: v for k, v in node.items() if k != "id"}
        attrs.setdefault("aliases", [])
        attrs.setdefault("label", node_id.split(":", 1)[-1])
        graph.add_node(node_id, **attrs)

    for edge in raw.get("edges") or []:
        src, dst, edge_type = edge.get("from"), edge.get("to"), edge.get("type")
        if edge_type not in EDGE_TYPES:
            errors.append(f"{src} -> {dst}: unknown edge type {edge_type!r}")
            continue
        if not graph.has_node(src):
            errors.append(f"{edge_type}: source node {src!r} does not exist")
            continue
        if not graph.has_node(dst):
            errors.append(f"{edge_type}: target node {dst!r} does not exist")
            continue
        want_src, want_dst = EDGE_DOMAINS[edge_type]
        got_src = graph.nodes[src]["type"]
        got_dst = graph.nodes[dst]["type"]
        if got_src != want_src or got_dst != want_dst:
            errors.append(
                f"{src} --{edge_type}--> {dst}: expected "
                f"{want_src} -> {want_dst}, got {got_src} -> {got_dst}"
            )
            continue
        graph.add_edge(src, dst, key=edge_type, type=edge_type)

    if errors:
        raise GraphValidationError(
            f"{len(errors)} problem(s) in {GRAPH_PATH.name}:\n  - " + "\n  - ".join(errors)
        )
    return graph


def load(force: bool = False) -> Any:
    """The graph, cached on the source file's mtime.

    Editing the YAML in development reloads on the next call without a restart —
    which matters because Blueprints' coverage view is the tool you author
    against, and a restart between every edit would make it useless for that.
    """
    global _cache, _cache_mtime, _cache_source
    import yaml  # noqa: PLC0415 — see requirements.txt

    with _lock:
        path = source_path()
        if not path.exists():
            raise GraphValidationError(
                f"no graph file — looked for the authored copy at {GRAPH_PATH} "
                f"and the packaged seed at {SEED_PATH}"
            )
        mtime = path.stat().st_mtime
        # The source is part of the cache key, not just its mtime: the first
        # authoring edit switches which file is being read, and a seed whose
        # mtime happened to match would otherwise serve stale content.
        if _cache is not None and not force and _cache_mtime == mtime and _cache_source == path:
            return _cache
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        _cache = _build(raw)
        _cache_mtime = mtime
        _cache_source = path
        return _cache


def node(node_id: str) -> dict[str, Any] | None:
    """One node as a plain dict, or None. Includes its id for round-tripping."""
    graph = load()
    if not graph.has_node(node_id):
        return None
    return {"id": node_id, **graph.nodes[node_id]}


def neighbours(node_id: str) -> dict[str, list[dict[str, Any]]]:
    """A node's immediate connections, split by direction.

    Both directions, because half this graph reads backwards: an SOPDocument's
    useful neighbour is the AnomalyType that RESOLVED_BY points at it, and an
    AnomalyType's history is the AnomalyRecords pointing in via INSTANCE_OF.
    """
    graph = load()
    if not graph.has_node(node_id):
        return {"outgoing": [], "incoming": []}

    outgoing = [
        {"edge": key, "node": {"id": dst, **graph.nodes[dst]}}
        for _, dst, key in graph.out_edges(node_id, keys=True)
    ]
    incoming = [
        {"edge": key, "node": {"id": src, **graph.nodes[src]}}
        for src, _, key in graph.in_edges(node_id, keys=True)
    ]
    return {"outgoing": outgoing, "incoming": incoming}


def schema() -> dict[str, Any]:
    """Node and edge types with live counts — drives the Blueprints legend."""
    graph = load()
    node_counts = {t: 0 for t in NODE_TYPES}
    for _, attrs in graph.nodes(data=True):
        node_counts[attrs["type"]] += 1

    edge_counts = {t: 0 for t in EDGE_TYPES}
    for _, _, key in graph.edges(keys=True):
        edge_counts[key] += 1

    return {
        "nodes": [
            {"type": t, "count": node_counts[t]} for t in NODE_TYPES
        ],
        "edges": [
            {
                "type": t,
                "count": edge_counts[t],
                "from": EDGE_DOMAINS[t][0],
                "to": EDGE_DOMAINS[t][1],
            }
            for t in EDGE_TYPES
        ],
        "total_nodes": graph.number_of_nodes(),
        "total_edges": graph.number_of_edges(),
    }


def coverage() -> Coverage:
    """Where the graph is structurally legal but semantically incomplete.

    Every entry here is a question Track 2 will answer worse than Track 1, and
    the point of surfacing it is that the dual-track comparison is only fair if
    Track 2's corpus is as complete as Track 1's (`MODULES.md` §3.3). This is how
    that gets checked rather than assumed.
    """
    graph = load()
    result = Coverage()

    def brief(node_id: str) -> dict[str, Any]:
        attrs = graph.nodes[node_id]
        return {"id": node_id, "type": attrs["type"], "label": attrs.get("label", node_id)}

    for node_id in graph.nodes:
        if graph.degree(node_id) == 0:
            result.orphans.append(brief(node_id))

    for node_id, attrs in graph.nodes(data=True):
        kind = attrs["type"]
        out_types = {key for _, _, key in graph.out_edges(node_id, keys=True)}

        if kind == "AnomalyType" and "RESOLVED_BY" not in out_types:
            result.unresolved_anomaly_types.append(brief(node_id))
        elif kind == "Sensor" and "HAS_THRESHOLD" not in out_types:
            result.sensors_without_thresholds.append(brief(node_id))
        elif kind == "Threshold" and "TRIGGERS" not in out_types:
            result.thresholds_without_triggers.append(brief(node_id))
        elif kind == "SOPDocument" and "CONTAINS" not in out_types:
            result.empty_sops.append(brief(node_id))

    return result


def _main() -> int:
    """`python -m app.services.knowledge_graph` — validate and report gaps.

    The authoring loop for the graph, usable before Blueprints exists: edit the
    YAML, run this, fix what it names. Exits non-zero on a validation failure so
    it can gate a commit, but *not* on a coverage gap — a gap is a to-do, not a
    broken graph, and failing on one would make the honest report of an
    unresolved AnomalyType something you are tempted to delete rather than fix.
    """
    try:
        load(force=True)
    except GraphValidationError as exc:
        print(f"INVALID: {exc}")
        return 1

    info = schema()
    print(f"{GRAPH_PATH.name}: {info['total_nodes']} nodes, {info['total_edges']} edges — valid\n")
    for row in info["nodes"]:
        print(f"  {row['type']:<15} {row['count']:>3}")
    print()
    for row in info["edges"]:
        print(f"  {row['type']:<15} {row['count']:>3}   {row['from']} -> {row['to']}")

    gaps = coverage().as_dict()
    print(f"\ncoverage gaps: {gaps.pop('total_gaps')}")
    for name, items in gaps.items():
        for item in items:
            print(f"  {name:<28} {item['id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
