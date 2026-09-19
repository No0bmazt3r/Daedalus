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
    params=(
        Param("query", str, "What to look for, in plain words.", required=True, max_length=500),
        Param("top_k", int, "How many passages to return.", default=5, minimum=1, maximum=_MAX_TOP_K),
        Param(
            "source_type", str, "Restrict to one kind of document.",
            default="any", enum=SOURCE_TYPES,
        ),
    ),
)
def search_corpus(query: str, top_k: int, source_type: str) -> dict[str, Any]:
    """Track 1 retrieval.

    Reads through the guarded `get_collection()`, so an index built by a
    different embedding model raises rather than returning results ranked by
    comparing two vector spaces. For a project whose claim is groundedness, a
    confident wrong ranking is the worst available outcome.
    """
    from .. import embedding_models  # noqa: PLC0415 — avoids an import cycle at boot

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
    found = collection.query(query_texts=[query], n_results=top_k, where=where)

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

    return {
        "data": {"chunks": chunks, "track": "vector"},
        "detail": f"{len(chunks)} passages from {state['collection']}"
                  if chunks else "no passage matched",
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
    params=(
        Param("query", str, "The question or phrase to find entities for.",
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
