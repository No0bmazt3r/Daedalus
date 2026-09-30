"""Search tools — finding candidate evidence *inside* the knowledge base.

The category where this project and its reference implementation disagree most.
Odysseus' search tools reach the internet; here `search` means the corpus and
the graph, and the web is not an option at runtime at all — see `registry.
EXCLUDED`, which records that as a decision rather than leaving it as an
absence.

Both tools answer the same question through the two tracks `PROJECT.md` §5 is
built to compare, and they are deliberately separate tools rather than one that
consults `rag_config`. The orchestrator is what selects a track; a tool that
quietly picked one would make "which track answered this" unanswerable from the
logs, and that question is the project's entire result.

They each declare that allegiance with `track=`, and the registry gate offers
only the selected arm's tool at runtime. Separate tools were always the right
shape; what was missing was the gate, and without it Track 1 was answering
questions with a `search_graph` call available the whole time.
"""

from __future__ import annotations

from typing import Any

from .. import graph_tools, knowledge_graph
from ...db import vector_store
from .registry import Effect, Integrity, Param, ToolError, register

# §7.2's cap, and the reason for it: retrieved chunks share the prompt with the
# evidence pack, and an SLM at num_ctx 4096 cannot afford twenty of them.
_MAX_TOP_K = 10

SOURCE_TYPES = ("manual", "sop", "anomaly_record", "uauc_record", "any")


@register(
    name="search_corpus",
    category="search",
    summary=(
        "Search the ingested document corpus (manuals, SOPs, anomaly and UAUC records) "
        "for passages relevant to a question. Track 1: vector similarity."
    ),
    effects={Effect.READ_CORPUS},
    integrity=Integrity.CORPUS,
    track="vector",
    params=(
        Param("query", str, "What to look for, in plain words.", required=True, max_length=500,
              example="reactor temperature limits"),
        Param("top_k", int, "How many passages to return.", default=5, minimum=1, maximum=_MAX_TOP_K),
        Param(
            "source_type", str, "Restrict to one kind of document.",
            default="any", enum=SOURCE_TYPES,
        ),
    ),
)
def search_corpus(query: str, top_k: int, source_type: str) -> dict[str, Any]:
    """Track 1 retrieval: nearest chunks by cosine, then re-ranked by a cross-encoder.

    Reads through the guarded `get_collection()`, so an index built by a
    different embedding model raises rather than returning results ranked by
    comparing two vector spaces. For a project whose claim is groundedness, a
    confident wrong ranking is the worst available outcome.

    With re-ranking on (`rag_config`, the default), Chroma is asked for a wider
    pool — `candidates`, at least `top_k` — and `reranker` keeps the `top_k`
    the cross-encoder scores highest. With it off or unable to run, Chroma's
    top `top_k` stand, and the detail says which happened and why: an answer
    built on un-reranked chunks is fine to give, but not to give silently.
    """
    from .. import embedding_models, ingestion, rag_config, reranker  # noqa: PLC0415 — avoids an import cycle at boot

    state = embedding_models.index_state()
    if state["index_state"] != "current":
        # An honest empty answer, with the reason, beats an exception: the
        # orchestrator's next move ("say you have no documents on this") is the
        # same either way, and the reason is what makes the log readable.
        return {
            "data": {"chunks": [], "track": "vector"},
            "detail": f"the corpus is not searchable: {state['index_detail']}",
        }

    try:
        collection = vector_store.get_collection()
    except vector_store.IndexMismatch as exc:
        raise ToolError(str(exc)) from exc
    if collection is None:
        return {
            "data": {"chunks": [], "track": "vector"},
            "detail": "the vector store is unreachable",
        }

    where = None if source_type == "any" else {"source_type": source_type}

    # `query_embeddings`, never `query_texts`. Handing Chroma raw text makes it
    # embed the query with its *own* bundled model — ONNX MiniLM — and compare
    # that vector against documents embedded by nomic-embed-text. It does not
    # error, it does not return nothing: it returns confidently ranked nonsense,
    # which for a project claiming groundedness is the worst available outcome.
    # `vector_store`'s stamp guard catches a mismatched *index*; this is the same
    # failure on the query side, where no stamp can see it.
    try:
        vector = ingestion.embed_query(query)
    except Exception as exc:  # noqa: BLE001 — an unreachable embedder is a stated result
        return {
            "data": {"chunks": [], "track": "vector"},
            "detail": f"the query could not be embedded, so the corpus was not searched: {exc}",
        }

    settings = rag_config.rerank_settings()
    pool = max(top_k, settings["candidates"]) if settings["enabled"] else top_k
    found = collection.query(query_embeddings=[vector], n_results=pool, where=where)

    documents = (found.get("documents") or [[]])[0]
    metadatas = (found.get("metadatas") or [[]])[0]
    distances = (found.get("distances") or [[]])[0]
    ids = (found.get("ids") or [[]])[0]

    chunks = []
    for index, text in enumerate(documents):
        meta = metadatas[index] if index < len(metadatas) else {}
        chunks.append({
            "chunk_id": ids[index] if index < len(ids) else None,
            "text": text,
            # Cosine distance, not similarity — reported as the store gave it
            # rather than converted, so a reader can check it against Chroma.
            "distance": distances[index] if index < len(distances) else None,
            "source_file": (meta or {}).get("source_file"),
            "section_title": (meta or {}).get("section_title"),
            "page_number": (meta or {}).get("page_number"),
            "source_type": (meta or {}).get("source_type"),
        })

    rerank: dict[str, Any] = {"enabled": settings["enabled"], "model": None,
                              "candidates": len(chunks), "latency_ms": None, "reason": None}
    if settings["enabled"] and chunks:
        try:
            chunks, rerank["latency_ms"] = reranker.rerank(
                query, chunks, model_id=settings["model"], keep=top_k)
            rerank["model"] = settings["model"]
        except reranker.RerankUnavailable as exc:
            chunks = chunks[:top_k]
            rerank["reason"] = str(exc)
    else:
        chunks = chunks[:top_k]
        if not settings["enabled"]:
            rerank["reason"] = "re-ranking is off"

    if not chunks:
        detail = "no passage matched"
    elif rerank["model"]:
        detail = (f"{len(chunks)} passages from {state['collection']}, re-ranked from "
                  f"{rerank['candidates']} by {rerank['model']}")
    else:
        detail = f"{len(chunks)} passages from {state['collection']} (vector order: {rerank['reason']})"

    return {
        # `collection` travels with the result so the dispatch boundary can
        # record *which index* answered without re-deriving it — two callers
        # resolving the collection separately is how a log ends up naming one
        # index while the query read another.
        "data": {"chunks": chunks, "track": "vector", "collection": state["collection"],
                 "rerank": rerank},
        "detail": detail,
    }


@register(
    name="search_graph",
    category="search",
    summary=(
        "Find entry points in the knowledge graph for a question — sensors, anomaly "
        "types, procedures and components whose names or aliases match. Track 2."
    ),
    effects={Effect.READ_GRAPH},
    integrity=Integrity.SYSTEM,
    track="graph",
    params=(
        Param("query", str, "The question or phrase to find entities for.",
              example="reactor temperature",
              required=True, max_length=500),
        Param("limit", int, "How many entry points to return.",
              default=6, minimum=1, maximum=_MAX_TOP_K),
    ),
)
def search_graph(query: str, limit: int) -> dict[str, Any]:
    """Track 2's entry-point finder.

    `SYSTEM` integrity rather than `CORPUS`: every node in this graph was
    authored in a file in this repository and reviewed in a diff. That is a
    stronger provenance than an ingested PDF, and the distinction is exactly what
    `Integrity` exists to carry.
    """
    if not knowledge_graph.schema()["total_nodes"]:
        return {"data": {"entries": [], "track": "graph"}, "detail": "the graph is empty"}

    nodes, strategy = graph_tools.graph_query_natural(query, limit=limit)
    return {
        "data": {"entries": nodes, "track": "graph", "entry_strategy": strategy},
        # The strategy is in the payload because §10's comparison asks how an
        # entry point was found, not only which one.
        "detail": f"{len(nodes)} entry points via {strategy}"
                  if nodes else f"nothing matched ({strategy})",
    }


# How many nodes of one type a hop may walk from. The graph is tens of nodes;
# this bounds a question that happens to alias-match many of them.
_WALK_FROM = 4


@register(
    name="graph_walk",
    category="search",
    summary=(
        "Track 2's baseline retrieval: find the graph's entry points for a question, then "
        "walk the schema's fixed path — anomaly type → resolving SOP → its steps, and "
        "sensor → its thresholds. One call, one recorded traversal."
    ),
    effects={Effect.READ_GRAPH},
    integrity=Integrity.SYSTEM,
    track="graph",
    params=(
        Param("query", str, "The question to find entry points for.", required=True,
              max_length=500, example="what should I do about high CO2"),
        Param("limit", int, "How many entry points to start from.",
              default=6, minimum=1, maximum=_MAX_TOP_K),
    ),
)
def graph_walk(query: str, limit: int) -> dict[str, Any]:
    """Entry search plus a deterministic walk, recorded as one `TraversalPath`.

    Why one tool rather than `search_graph` followed by `graph_traverse` calls:
    Blueprints replays a query from **one** `rag_logs` row holding the whole
    path (the seeder writes exactly that shape), and the dispatch boundary
    writes one row per retrieval call. Split across four calls, the walk became
    four rows of which the replay could show only the last hop.

    The path is fixed on purpose. It is the baseline M6's agent loop — which
    chooses each hop and records a sufficiency verdict — is measured against, so
    it must not be clever. Every hop is still recorded, dead ends included.
    """
    if not knowledge_graph.schema()["total_nodes"]:
        return {"data": {"nodes": [], "track": "graph"}, "detail": "the graph is empty"}

    path = graph_tools.TraversalPath(entry_query=query)
    entries, strategy = graph_tools.graph_query_natural(query, limit=limit)
    path.entry_strategy = strategy
    path.entry_nodes = [n["id"] for n in entries]

    sub = graph_tools.Subgraph()
    for node in entries:
        sub.add_node(node["id"])

    def ids(node_type: str, among: list[dict[str, Any]] | None = None) -> list[str]:
        pool = among if among is not None else sub.of_type(node_type)
        return [n["id"] for n in pool if n.get("type") == node_type][:_WALK_FROM]

    anomaly_types = ids("AnomalyType")
    if anomaly_types:
        sub = graph_tools.graph_traverse(anomaly_types, "RESOLVED_BY", subgraph=sub, path=path)
    sops = ids("SOPDocument")
    if sops:
        sub = graph_tools.graph_traverse(sops, "CONTAINS", subgraph=sub, path=path)
    sensors = ids("Sensor", entries)
    if sensors:
        sub = graph_tools.graph_traverse(sensors, "HAS_THRESHOLD", subgraph=sub, path=path)

    walked = sub.as_dict()
    return {
        "data": {
            # Entry points first, then what the walk reached, so the evidence
            # pack cites them in the order the walk found them.
            "nodes": walked["nodes"],
            "edges": walked["edges"],
            "entry_nodes": path.entry_nodes,
            "entry_strategy": strategy,
            "path": path.as_dict(),
            "track": "graph",
        },
        "detail": (
            f"{len(walked['nodes'])} nodes, {path.hop_count} hops from {len(entries)} entry points via {strategy}"
            if entries else f"nothing matched ({strategy})"
        ),
    }
