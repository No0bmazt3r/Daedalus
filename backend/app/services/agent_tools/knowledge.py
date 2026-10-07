"""Knowledge tools — reading the knowledge base's structure and its provenance.

`search` finds passages; this category answers questions *about* the knowledge
base. Two reasons that separation is worth having:

1. **Traversal is not search.** `graph_traverse` is Track 2's actual mechanism —
   the agent follows an edge because it decided the last hop was insufficient
   (`research/03` §7). Filing it under "search" would suggest one retrieval,
   which is precisely the difference from Track 1 that the comparison measures.
2. **"What do you even have?" is a real question**, and answering it wrongly is
   how a model ends up asserting that a procedure exists. `MODULES.md` §3.3 is
   about omission being invisible; `knowledge_status` makes it visible to the
   orchestrator, not only to a person looking at Blueprints.

Odysseus' equivalent category is `manage_memory` — a store the model writes
facts into about its user. There is no counterpart here on purpose: a reactor
assistant's knowledge is the reviewed corpus and the authored graph, and a model
that could add to its own knowledge base could add something nobody approved.

## Which of these belong to a track

The three `graph_*` tools read Track 2's structure, so they carry `track="graph"`
and the registry withholds them while Track 1 is selected. `PROJECT.md` §5's
comparison is only a comparison if each arm is confined to its own retrieval, and
`graph_lookup` is retrieval whatever its category says — a model that cannot
`search_graph` but can still `graph_lookup` its way to the same nodes is running
Track 2 under Track 1's name.

`knowledge_status` is the exception and carries no track. It *reports on* both
arms without retrieving through either: no node text, no chunk text, just
readiness and counts. Gating it would leave a model unable to check whether the
corpus it is about to fail to find anything in even exists, which is the check
that makes "I don't have that" a statement rather than a guess — and that matters
most, not least, on the arm that is not ready.
"""

from __future__ import annotations

from typing import Any

from .. import graph_tools, knowledge_graph
from .registry import Effect, Integrity, Param, ToolError, register


@register(
    name="graph_lookup",
    category="knowledge",
    summary=(
        "Look up one entity in the knowledge graph by name or alias, and return what "
        "is authored about it."
    ),
    effects={Effect.READ_GRAPH},
    track="graph",
    params=(
        Param("entity", str, "The name or alias to look up.", required=True, max_length=200,
              example="temperature"),
        Param(
            "entity_type", str, "Restrict to one node type.",
            default=None, enum=tuple(knowledge_graph.NODE_TYPES),
        ),
    ),
)
def graph_lookup(entity: str, entity_type: str | None) -> dict[str, Any]:
    nodes = graph_tools.graph_lookup(entity, entity_type)
    return {
        "data": {"nodes": nodes},
        "detail": f"{len(nodes)} matched" if nodes else f"nothing in the graph matches {entity!r}",
    }


@register(
    name="graph_traverse",
    category="knowledge",
    summary=(
        "Walk the knowledge graph from one or more nodes along a relationship — for "
        "example from an anomaly type to the procedure that resolves it."
    ),
    effects={Effect.READ_GRAPH},
    track="graph",
    params=(
        Param("start_node_ids", list, "Node ids to start from.", required=True,
              example="Sensor:temp_c"),
        Param(
            "relationship", str, "The edge type to follow.",
            required=True, enum=tuple(knowledge_graph.EDGE_TYPES),
            # An enum does not normally need an example — the panel prints the
            # permitted set. This one does, because the first edge type is not
            # the one that returns something from the example start node, and a
            # filled-in trial that comes back empty reads as a broken tool.
            example="HAS_THRESHOLD",
        ),
        Param("max_hops", int, "How far to walk.", default=1, minimum=1, maximum=4),
        Param(
            "reverse", bool,
            "Follow the edge backwards — an SOP's trigger is the anomaly pointing at it.",
            default=False,
        ),
    ),
)
def graph_traverse(
    start_node_ids: list, relationship: str, max_hops: int, reverse: bool
) -> dict[str, Any]:
    """One walk, with its path.

    `max_hops` is capped at 4 by the declaration rather than by this function,
    which is M6's "cap max_hops and add a timeout guard" done at the boundary:
    a model that asks for 50 hops is refused before the graph is loaded.
    """
    ids = [str(n) for n in start_node_ids if str(n).strip()]
    if not ids:
        raise ToolError("start_node_ids must contain at least one node id")

    path = graph_tools.TraversalPath()
    subgraph = graph_tools.graph_traverse(
        ids, relationship, max_hops=max_hops, path=path, reverse=reverse
    ).as_dict()
    reached = subgraph["nodes"]
    return {
        "data": {
            "nodes": reached,
            "edges": subgraph["edges"],
            # A recorded dead end is evidence that the graph was asked and had
            # nothing, which §3.3 counts as a result rather than as noise — and
            # it is what Blueprints replays, so it travels with the answer.
            "path": path.as_dict(),
        },
        "detail": f"{len(reached)} nodes reached over {relationship}"
                  if reached else f"no node is reachable from there over {relationship}",
    }


@register(
    name="knowledge_status",
    category="knowledge",
    summary=(
        "What this system actually knows: whether each retrieval track is ready, how "
        "much is in it, and what it therefore cannot answer."
    ),
    effects={Effect.READ_SYSTEM, Effect.READ_GRAPH},
    params=(),
)
def knowledge_status() -> dict[str, Any]:
    """The tool that makes "I don't have that" a checkable statement.

    A model asked about a procedure that was never ingested has two honest
    moves — say so, or check first. This is the check. Without it the only
    available behaviour is to answer from training data, which is the failure
    mode the <10% hallucination target is measuring.
    """
    from .. import embedding_models, rag_config  # noqa: PLC0415 — import cycle at boot

    index = embedding_models.index_state()
    graph = knowledge_graph.schema()
    track = rag_config.resolve()

    return {
        "data": {
            "active_track": track,
            "vector": {
                "ready": index["index_state"] == "current",
                "state": index["index_state"],
                "detail": index["index_detail"],
                "chunks": index.get("index_documents"),
            },
            "graph": {
                "ready": graph["total_nodes"] > 0,
                "nodes": graph["total_nodes"],
                "edges": graph["total_edges"],
                "node_types": graph.get("node_types"),
            },
        },
        "detail": (
            f"track {track} · graph {graph['total_nodes']} nodes · "
            f"vector index {index['index_state']}"
        ),
    }


@register(
    name="graph_coverage",
    category="knowledge",
    summary=(
        "Which question types the knowledge graph can and cannot answer, so an "
        "unanswerable question is reported rather than guessed at."
    ),
    effects={Effect.READ_GRAPH},
    track="graph",
    params=(),
)
def graph_coverage() -> dict[str, Any]:
    """`MODULES.md` §3.3's known-gaps table, exposed to the orchestrator.

    The graph is hand-authored, so its gaps are known and written down. A model
    that can read them can say "the graph has no data on that" instead of
    traversing hopefully and reporting silence as absence of fact.
    """
    coverage = knowledge_graph.coverage()
    payload = coverage.as_dict() if hasattr(coverage, "as_dict") else coverage
    if not isinstance(payload, dict):
        payload = {"coverage": str(payload)}
    return {"data": payload, "detail": "authored coverage and known gaps"}
