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

import re
from typing import Any

from ...db import vector_store
from .. import graph_tools, knowledge_graph
from .registry import Effect, Integrity, Param, ToolError, register

# §7.2's cap, and the reason for it: retrieved chunks share the prompt with the
# evidence pack, and an SLM at num_ctx 4096 cannot afford twenty of them.
_MAX_TOP_K = 10

SOURCE_TYPES = ("manual", "sop", "anomaly_record", "uauc_record", "other", "any")


# Reciprocal Rank Fusion's constant, from Cormack et al. (2009) and still the
# usual default: large enough that rank 1 vs 2 is not decisive on its own.
RRF_K = 60


def fuse(dense: list[dict[str, Any]], lexical: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge two best-first rankings by RRF: score = Σ 1 / (RRF_K + rank).

    Ranks, not scores, because cosine distance and bm25 are on scales nothing
    relates; RRF needs no tuning and no labelled set to calibrate. Each chunk
    keeps its place in both lists (`dense_rank`, `keyword_rank`, None when
    absent) so a log reader can see which half found it.
    """
    merged: dict[str, dict[str, Any]] = {}
    for field, ranking in (("dense_rank", dense), ("keyword_rank", lexical)):
        for rank, chunk in enumerate(ranking, 1):
            key = chunk.get("chunk_id") or f"{field}:{rank}"
            entry = merged.setdefault(key, {
                "chunk_id": chunk.get("chunk_id"), "text": chunk.get("text"),
                "distance": chunk.get("distance"), "source_file": chunk.get("source_file"),
                "section_title": chunk.get("section_title"), "page_number": chunk.get("page_number"),
                "source_type": chunk.get("source_type"),
                "dense_rank": None, "keyword_rank": None, "rrf_score": 0.0,
            })
            entry[field] = rank
            entry["rrf_score"] += 1 / (RRF_K + rank)
    # Stable sort: equal scores keep the vector order.
    return sorted(merged.values(), key=lambda c: -c["rrf_score"])


# Words that say nothing about where in a chunk the answer is.
_STOP = frozenset(
    "the and what how for with does this that are was were which when where who why should from into "
    "about have has you can there their then than will would could our your its not any all".split()
)


def focus(query: str, around: dict[int, dict[str, Any]], width: int | None = None) -> str:
    """The `width` characters of a chunk (and its neighbours) holding the most query terms.

    The evidence pack shows each passage's first `PASSAGE_CHARS`, so whatever a
    1,500-character chunk says after that never reaches the model — and an
    answer that starts at the end of one chunk continues into the next. This
    joins the chunk with its neighbours' non-overlapping parts (exact offsets,
    no repeated text) and picks the sentence-aligned window covering the most
    distinct query terms, ties going to the one that starts nearest its first
    match — so what follows the matched words is shown, not cut off. The window must overlap
    the chunk itself, so the passage is still about what was cited. With no
    term anywhere, it is the chunk's head — the old behaviour.
    """
    from ..orchestration import evidence  # noqa: PLC0415 — the cap lives with the pack

    width = width or evidence.PASSAGE_CHARS
    core = around.get(0)
    if not core:
        return ""
    prev, nxt = around.get(-1), around.get(1)
    before = prev["text"][: max(0, core["char_start"] - prev["char_start"])] if prev else ""
    after = nxt["text"][max(0, core["char_end"] - nxt["char_start"]):] if nxt else ""
    span = before + core["text"] + after
    lo, hi = len(before), len(before) + len(core["text"])

    terms = {t.lower() for t in re.findall(r"\w[\w\-./]*", query)
             if (len(t) >= 3 or not t.islower()) and t.lower() not in _STOP}
    starts = [lo] + [m.end() for m in re.finditer(r"[.!?:]\s+|\n+", span)]
    best, best_key = lo, (0, 0)
    lowered = span.lower()
    for start in sorted(set(starts)):
        if start >= hi or start + width <= lo:
            continue
        window = lowered[start:start + width]
        found = [window.find(t) for t in terms if t in window]
        key = (len(found), -min(found)) if found else (0, 0)
        if key > best_key:
            best, best_key = start, key
    return span[best:best + width].strip()


@register(
    name="search_corpus",
    category="search",
    summary=(
        "Search the ingested document corpus (manuals, SOPs, troubleshooting and safety documents) "
        "for passages relevant to a question. Track 1: vector similarity plus keyword (BM25) matching, re-ranked."
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
    """Track 1 retrieval: nearest chunks by cosine, fused (RRF) with BM25 keyword
    hits when `retrieval.hybrid` is on, then re-ranked by a cross-encoder.

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

    # The ablation's cut-off, before re-ranking: a passage the embedder
    # already judged too far away is not one the cross-encoder should rescue.
    retrieval = rag_config.retrieval_settings()
    threshold = retrieval["similarity_threshold"]
    dropped = 0
    if threshold is not None:
        kept = [c for c in chunks if c["distance"] is None or 1 - c["distance"] >= threshold]
        dropped = len(chunks) - len(kept)
        chunks = kept

    # Hybrid: a BM25 ranking from the manifest's FTS5 index, fused with the
    # vector one. Exact tokens (ABV-1, alarm codes) are where embeddings are
    # weakest and keywords strongest. The threshold above is a cosine cut-off,
    # so it applies to the vector side only — a keyword hit has no distance.
    keyword: dict[str, Any] = {"enabled": retrieval["hybrid"], "hits": 0, "reason": None}
    if retrieval["hybrid"]:
        from ...db import corpus_store  # noqa: PLC0415

        try:
            lexical = corpus_store.keyword_search(
                query, collection=state["collection"], limit=pool,
                source_type=None if source_type == "any" else source_type)
        except Exception as exc:  # noqa: BLE001 — a missing index degrades to vector-only, said aloud
            lexical, keyword["reason"] = [], str(exc)
        keyword["hits"] = len(lexical)
        chunks = fuse(chunks, lexical)[:pool]

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

    # Abstention: the cross-encoder judged these passages irrelevant, so none of
    # them reaches the model — an empty result is what makes the evidence pack
    # say NO DOCUMENTS FOUND instead of inviting a guess from five bad passages.
    # Only a cross-encoder score can be judged this way; with re-ranking
    # unavailable the floor is skipped, and the detail says so.
    floor = retrieval["min_rerank_score"]
    abstained = 0
    if floor is not None and rerank["model"]:
        kept = [c for c in chunks if c.get("rerank_score", 0) >= floor]
        abstained = len(chunks) - len(kept)
        chunks = kept

    # Whose document each passage came from — this rig's, or another
    # installation's. From the manifest, not the vector metadata, so a corrected
    # origin applies now; a chunk the manifest has lost counts as a reference.
    try:
        from ...db import corpus_store  # noqa: PLC0415

        origins = corpus_store.origins_for([c["chunk_id"] for c in chunks if c.get("chunk_id")])
    except Exception:  # noqa: BLE001 — an unreadable manifest must not hide the passages
        origins = {}
    for c in chunks:
        c["origin"] = origins.get(c.get("chunk_id"), "reference")

    if retrieval["window"] == "focused" and chunks:
        try:
            from ...db import corpus_store  # noqa: PLC0415

            around = corpus_store.neighbours([c["chunk_id"] for c in chunks if c.get("chunk_id")])
        except Exception:  # noqa: BLE001 — the head of the chunk is still a valid passage
            around = {}
        for c in chunks:
            if c.get("chunk_id") in around:
                c["passage"] = focus(query, around[c["chunk_id"]])

    if not chunks and abstained:
        detail = (f"no passage matched: all {abstained} scored below {floor:g} by the re-ranker, "
                  "so the corpus is treated as not covering this")
    elif not chunks:
        detail = "no passage matched" + (f" above similarity {threshold:g}" if dropped else "")
    elif rerank["model"]:
        detail = (f"{len(chunks)} passages from {state['collection']}, re-ranked from "
                  f"{rerank['candidates']} by {rerank['model']}")
    else:
        detail = f"{len(chunks)} passages from {state['collection']} (vector order: {rerank['reason']})"
    if chunks and dropped:
        detail += f"; {dropped} below similarity {threshold:g} dropped"
    if chunks and abstained:
        detail += f"; {abstained} below re-rank score {floor:g} dropped"
    if floor is not None and not rerank["model"]:
        detail += "; re-rank score floor not applied (no re-rank scores)"
    if keyword["enabled"]:
        detail += (f"; hybrid with {keyword['hits']} keyword hits" if keyword["reason"] is None
                   else f"; keyword search failed, vector only: {keyword['reason']}")

    return {
        # `collection` travels with the result so the dispatch boundary can
        # record *which index* answered without re-deriving it — two callers
        # resolving the collection separately is how a log ends up naming one
        # index while the query read another.
        "data": {"chunks": chunks, "track": "vector", "collection": state["collection"],
                 "rerank": rerank, "keyword": keyword, "below_min_score": abstained,
                 "similarity_threshold": threshold, "below_threshold": dropped},
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
        "walk the schema's fixed path — sensor → its thresholds → the anomaly types they "
        "trigger → the resolving SOP → its steps. One call, one recorded traversal."
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

    # The schema's one causal chain, in order. Each hop walks from every node of
    # its start type gathered so far — entry points and what earlier hops
    # reached — so a question that enters at a sensor still arrives at the
    # procedure, and one that names the procedure skips straight to its steps.
    for start_type, relationship in (
        ("Sensor", "HAS_THRESHOLD"),
        ("Threshold", "TRIGGERS"),
        ("AnomalyType", "RESOLVED_BY"),
        ("SOPDocument", "CONTAINS"),
    ):
        starts = ids(start_type)
        if starts:
            sub = graph_tools.graph_traverse(starts, relationship, subgraph=sub, path=path)

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


@register(
    name="graph_agent",
    category="search",
    summary=(
        "Track 2's agentic retrieval: find the graph's entry points for a question, then let "
        "the local model choose each hop and judge when it has enough. Bounded by a step "
        "limit and a time budget. One call, one recorded traversal."
    ),
    effects={Effect.READ_GRAPH, Effect.INFERENCE},
    integrity=Integrity.SYSTEM,
    track="graph",
    params=(
        Param("query", str, "The question to find entry points for.", required=True,
              max_length=500, example="pressure and temperature both spiked, what do I do"),
        Param("limit", int, "How many entry points to start from.",
              default=6, minimum=1, maximum=_MAX_TOP_K),
    ),
)
def graph_agent(query: str, limit: int) -> dict[str, Any]:
    """The agent loop (`graph_agent.run`), under the settings in `rag_config`.

    Its own tool rather than a flag on `graph_walk`, so `tool_logs` names which
    mode ran without opening the path, and Settings can describe each in its own
    words. The budget and step limit are read here on every call rather than
    taken as arguments: they are part of the frozen comparison, not something a
    caller may vary per query.
    """
    from .. import graph_agent as agent  # noqa: PLC0415 — avoids an import cycle at boot
    from .. import rag_config

    if not knowledge_graph.schema()["total_nodes"]:
        return {"data": {"nodes": [], "track": "graph"}, "detail": "the graph is empty"}
    settings = rag_config.graph_settings()
    return agent.run(query, limit=limit, budget_s=settings["budget_s"], max_steps=settings["max_steps"])
