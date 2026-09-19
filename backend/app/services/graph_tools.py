"""Graph retrieval tools — Track 2's tool surface.

The three tools from `docs/research/03-agentic-graphrag-spec.md` §7, which the
agent loop calls iteratively based on its own sufficiency assessment. That
iteration is the core architectural difference from Track 1: vector RAG retrieves
once, this decides whether to keep going.

## Track 2 is deliberately embedding-free

The spec originally defined `graph_query_natural` as *"embed query, do a vector
search over node/edge text descriptions."* That is dropped here on purpose.

The reason is that it blurs the comparison this project exists to make. If both
tracks depend on an embedding model, the dual-track result cannot separate "the
graph structure helped" from "the embeddings helped", and a reviewer is entitled
to ask which one moved the number. Entry points are instead found by the
`aliases` authored on each node, with a stdlib fuzzy fallback for near-misses.
At tens of nodes this is not a compromise — an authored alias table is *more*
precise than cosine similarity over 37 short descriptions, and it is
deterministic, which matters for a comparison that has to be re-runnable.

So the honest framing for the report is not "the graph track needs no model" —
it needs a *more* capable one, since the model drives traversal (`research/03`
§10). It is that **Track 1 is pinned to an embedding model and Track 2 is pinned
to none**: swapping the embedding model invalidates Track 1's whole index, and
costs Track 2 nothing, because there is no index.

## Every traversal records its own path

`MODULES.md` §3.2 makes traversal replay the feature that earns Labyrinth
Blueprints, and a replay needs the path. `rag_logs.hop_count` records that a walk
was three hops without recording which three — so `graph_traverse` accumulates a
`TraversalPath` regardless of who called it, and the agent loop, when it is
built, only has to persist what the tool already produced.

That ordering is deliberate: it means the viewer can be built and tested against
real traversals before the agent exists.
"""

from __future__ import annotations

import difflib
import re
import time
from dataclasses import dataclass, field
from typing import Any

from . import knowledge_graph as kg

# Below this ratio a fuzzy match is noise. difflib's SequenceMatcher ratio is
# roughly "share of characters in common", so 0.82 rejects "pressure" against
# "temperature" while still accepting a plural or a typo.
_FUZZY_CUTOFF = 0.82

_NORMALISE = re.compile(r"[^a-z0-9]+")

# Words that carry no entity signal. Not a general stopword list — just the
# scaffolding of a plant question, so "what is the co2 level" reduces to tokens
# worth matching rather than matching "level" against Sensor:level_pct by
# accident when the question was about CO₂.
_NOISE = frozenset({
    "what", "when", "where", "which", "who", "why", "how", "is", "are", "was",
    "were", "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for",
    "do", "does", "did", "i", "we", "should", "can", "could", "has", "have",
    "had", "it", "this", "that", "there", "then", "if", "with", "from", "by",
    "me", "my", "any", "all", "get", "show", "tell", "about", "happened",
    "happen", "going", "now", "please",
})


def _norm(text: str) -> str:
    return _NORMALISE.sub(" ", str(text).lower()).strip()


@dataclass
class Hop:
    """One step of a walk.

    `from`/`to` are the node *sets* the hop spanned; `edges` is which of them
    were actually joined. Both are stored because neither implies the other: a
    hop from two Sensors to two Thresholds has four possible pairings and only
    two real ones, so a renderer given only the sets has to guess — and guessing
    draws edges the graph does not contain.

    Migration 005's example predates `edges` and shows the other five keys. It
    is additive, and this docstring is the authoritative shape; the migration is
    applied and checksummed, so it is not edited.
    """

    hop: int
    from_nodes: list[str]
    edge: str
    to_nodes: list[str]
    edges: list[dict[str, str]] = field(default_factory=list)
    sufficient: bool | None = None
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "hop": self.hop,
            "from": self.from_nodes,
            "edge": self.edge,
            "to": self.to_nodes,
            "edges": self.edges,
            "sufficient": self.sufficient,
            "reason": self.reason,
        }


@dataclass
class TraversalPath:
    """The walk, accumulated as it happens.

    Serialises straight into `rag_logs.traversal_path`; `entry_strategy` lands in
    the sibling column so the report can state from the data — not from this
    docstring — that Track 2 never fell back to embeddings.
    """

    entry_query: str = ""
    entry_strategy: str | None = None
    entry_nodes: list[str] = field(default_factory=list)
    hops: list[Hop] = field(default_factory=list)
    started_at: float = field(default_factory=time.perf_counter)

    def record(
        self,
        from_nodes: list[str],
        edge: str,
        to_nodes: list[str],
        *,
        edges: list[dict[str, str]] | None = None,
        sufficient: bool | None = None,
        reason: str | None = None,
    ) -> Hop:
        hop = Hop(
            len(self.hops) + 1,
            sorted(from_nodes),
            edge,
            sorted(to_nodes),
            edges or [],
            sufficient,
            reason,
        )
        self.hops.append(hop)
        return hop

    def mark(self, sufficient: bool, reason: str) -> None:
        """Attach the agent's sufficiency verdict to the most recent hop."""
        if self.hops:
            self.hops[-1].sufficient = sufficient
            self.hops[-1].reason = reason

    @property
    def hop_count(self) -> int:
        return len(self.hops)

    @property
    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self.started_at) * 1000)

    def as_dict(self) -> dict[str, Any]:
        return {
            "entry_query": self.entry_query,
            "entry_strategy": self.entry_strategy,
            "entry_nodes": self.entry_nodes,
            "hops": [h.as_dict() for h in self.hops],
            "hop_count": self.hop_count,
            "elapsed_ms": self.elapsed_ms,
        }


@dataclass
class Subgraph:
    """What the agent has gathered so far — the evidence pack for Track 2.

    `frontier` is the nodes reached by the most recent hop, which is what the
    next traversal walks from. Without it a multi-hop walk re-expands everything
    it already visited and hop 3 costs what hops 1–3 cost together.
    """

    nodes: dict[str, dict[str, Any]] = field(default_factory=dict)
    edges: list[dict[str, str]] = field(default_factory=list)
    frontier: list[str] = field(default_factory=list)

    def add_node(self, node_id: str) -> bool:
        if node_id in self.nodes:
            return False
        found = kg.node(node_id)
        if found is None:
            return False
        self.nodes[node_id] = found
        return True

    def add_edge(self, src: str, edge_type: str, dst: str) -> None:
        entry = {"from": src, "type": edge_type, "to": dst}
        if entry not in self.edges:
            self.edges.append(entry)

    @property
    def is_empty(self) -> bool:
        return not self.nodes

    def of_type(self, node_type: str) -> list[dict[str, Any]]:
        return [n for n in self.nodes.values() if n.get("type") == node_type]

    def as_dict(self) -> dict[str, Any]:
        return {
            "nodes": list(self.nodes.values()),
            "edges": self.edges,
            "frontier": self.frontier,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
        }


# ── entry points: alias index ────────────────────────────────────────────────


def _alias_index() -> dict[str, list[str]]:
    """Every searchable surface form → the node ids it names.

    Rebuilt per call and not cached: `kg.load()` already caches on mtime, and
    building this over tens of nodes is microseconds. Caching it separately would
    mean a second invalidation path to keep in sync with the first.
    """
    index: dict[str, list[str]] = {}
    graph = kg.load()
    for node_id, attrs in graph.nodes(data=True):
        forms = [node_id, node_id.split(":", 1)[-1], attrs.get("label", "")]
        forms.extend(attrs.get("aliases") or [])
        if attrs.get("column"):
            forms.append(attrs["column"])
        if attrs.get("filename"):
            forms.append(str(attrs["filename"]).rsplit(".", 1)[0])
        for form in forms:
            key = _norm(form)
            if not key:
                continue
            index.setdefault(key, [])
            if node_id not in index[key]:
                index[key].append(node_id)
    return index


def graph_lookup(entity: str, entity_type: str | None = None) -> list[dict[str, Any]]:
    """Find nodes matching an entity name or type.

    Exact alias match first, fuzzy only as a fallback — a fuzzy hit that shadows
    an exact one is how "pH" ends up resolving to "pressure".
    """
    index = _alias_index()
    key = _norm(entity)
    hits: list[str] = list(index.get(key, []))

    if not hits and key:
        for close in difflib.get_close_matches(key, list(index), n=3, cutoff=_FUZZY_CUTOFF):
            hits.extend(node_id for node_id in index[close] if node_id not in hits)

    nodes = [n for n in (kg.node(h) for h in hits) if n is not None]
    if entity_type:
        nodes = [n for n in nodes if n.get("type") == entity_type]
    return nodes


def graph_query_natural(query: str, *, limit: int = 6) -> tuple[list[dict[str, Any]], str]:
    """Find entry points from a whole question, without embedding anything.

    Returns the matched nodes and which strategy found them (`alias` | `fuzzy` |
    `none`), because that verdict is what migration 005's `entry_strategy` column
    records — the evidence that Track 2 stayed embedding-free.

    Longest phrases are tried first so "solvent level" beats a bare "level".
    """
    tokens = [t for t in _norm(query).split() if t and t not in _NOISE]
    if not tokens:
        return [], "none"

    index = _alias_index()
    found: dict[str, dict[str, Any]] = {}
    strategy = "none"

    for size in (3, 2, 1):
        for i in range(len(tokens) - size + 1):
            phrase = " ".join(tokens[i : i + size])
            for node_id in index.get(phrase, []):
                if node_id not in found:
                    node = kg.node(node_id)
                    if node is not None:
                        found[node_id] = node
                        strategy = "alias"

    if not found:
        for token in tokens:
            for close in difflib.get_close_matches(token, list(index), n=2, cutoff=_FUZZY_CUTOFF):
                for node_id in index[close]:
                    if node_id not in found:
                        node = kg.node(node_id)
                        if node is not None:
                            found[node_id] = node
                            strategy = "fuzzy"

    return list(found.values())[:limit], strategy


# ── traversal ────────────────────────────────────────────────────────────────


def graph_traverse(
    start_node_ids: list[str] | str,
    relationship: str,
    *,
    max_hops: int = 1,
    subgraph: Subgraph | None = None,
    path: TraversalPath | None = None,
    reverse: bool = False,
) -> Subgraph:
    """Walk outward along one relationship type, recording every hop.

    `reverse=True` walks the edge backwards, which half this schema needs: an
    AnomalyType's history is the AnomalyRecords pointing *in* via INSTANCE_OF,
    and an SOP's trigger is the AnomalyType pointing *in* via RESOLVED_BY.

    A hop that reaches nothing is still recorded, with an empty `to`. That is not
    noise — `MODULES.md` §3.3 is about omission being invisible, and a recorded
    dead end is exactly the evidence that the graph was asked and had no answer.
    """
    if relationship not in kg.EDGE_TYPES:
        raise ValueError(f"unknown relationship {relationship!r}; expected one of {kg.EDGE_TYPES}")

    graph = kg.load()
    sub = subgraph if subgraph is not None else Subgraph()
    starts = [start_node_ids] if isinstance(start_node_ids, str) else list(start_node_ids)

    frontier = [n for n in starts if graph.has_node(n)]
    for node_id in frontier:
        sub.add_node(node_id)

    for _ in range(max_hops):
        if not frontier:
            break
        reached: list[str] = []
        crossed: list[dict[str, str]] = []
        for node_id in frontier:
            edges = (
                graph.in_edges(node_id, keys=True) if reverse else graph.out_edges(node_id, keys=True)
            )
            for src, dst, key in edges:
                if key != relationship:
                    continue
                other = src if reverse else dst
                sub.add_node(other)
                sub.add_edge(src, key, dst)
                # Stored in graph direction, not walk direction, so a replay
                # draws the arrow the way the schema declares it even when the
                # walk followed it backwards.
                crossed.append({"from": src, "to": dst})
                if other not in reached:
                    reached.append(other)

        if path is not None:
            path.record(
                frontier,
                f"{relationship}{'↩' if reverse else ''}",
                reached,
                edges=crossed,
            )

        if not reached:
            break
        frontier = reached

    sub.frontier = frontier
    return sub
