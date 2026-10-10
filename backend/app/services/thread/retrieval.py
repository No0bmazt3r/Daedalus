"""What a turn retrieved, laid out for comparing the two tracks."""

from __future__ import annotations

import re
from typing import Any

from ...db import audit_store, chat_store
from .common import parse_json


def _list(value: Any) -> list[Any]:
    parsed = parse_json(value)
    return parsed if isinstance(parsed, list) else []


def retrieval(query_id: str) -> dict[str, Any] | None:
    """Everything this turn retrieved, per retrieval, in the form a comparison needs.

    Track 1: each chunk with its document, page, section, distance, re-rank
    score, origin (rig or reference, as logged), the chunking it was cut with
    (from its ingest run), and whether the answer cited it. Track 2: the entry
    strategy, the walk hop by hop, and which nodes the answer cited. Chunk text
    is joined from the corpus now, so a chunk re-chunked away since is reported
    as missing rather than dropped (the same rule as Blueprints' replay).
    """
    from ...db import corpus_store  # noqa: PLC0415
    from .. import knowledge_graph as kg  # noqa: PLC0415

    rows = audit_store.trace(query_id)
    if not rows.get("conversation_logs"):
        return None
    convo = rows["conversation_logs"][-1]
    validation = parse_json(convo.get("validation_json"))
    cited = set((validation or {}).get("cited") or []) if isinstance(validation, dict) else set()
    message = chat_store.message_for_query(query_id)
    evidence = message.get("evidence") if message else None
    citations = (evidence or {}).get("citations") or [] if isinstance(evidence, dict) else []
    # chunk id / node id → the label the model saw it under ("D2", "G1").
    # Turns stored before the citation fix carry a graph node's name under
    # `label`; only a real evidence label ("D2", "G1") is trusted.
    label_of = {
        (c.get("chunk_id") or c.get("node_id")): c.get("label")
        for c in citations
        if isinstance(c, dict) and re.fullmatch(r"[A-Z]\d+", str(c.get("label") or ""))
    }

    out: list[dict[str, Any]] = []
    for row in rows.get("rag_logs") or []:
        track = row.get("track")
        base = {
            "track": track,
            "query": row.get("query_text"),
            "top_k": row.get("top_k"),
            "store": row.get("vector_db_used"),
            "retrieval_ms": row.get("retrieval_latency_ms"),
            "rerank_ms": row.get("rerank_latency_ms"),
            "rerank_model": row.get("rerank_model"),
            "candidates": row.get("candidate_count"),
        }
        if track == "graph":
            path = parse_json(row.get("traversal_path"))
            path = path if isinstance(path, dict) else {}
            node_ids = list(dict.fromkeys(
                [*(path.get("entry_nodes") or [])]
                + [n for hop in path.get("hops") or [] for n in [*hop.get("from", []), *hop.get("to", [])]]
            ))
            nodes = []
            for node_id in node_ids:
                node = kg.node(node_id)
                label = label_of.get(node_id)
                nodes.append({
                    "id": node_id,
                    "type": (node or {}).get("type"),
                    "name": (node or {}).get("label") or node_id,
                    "missing": node is None,
                    "label": label,
                    "cited": bool(label and label in cited),
                })
            out.append({
                **base,
                "entry_strategy": row.get("entry_strategy") or path.get("entry_strategy"),
                "entry_nodes": path.get("entry_nodes") or [],
                "hops": path.get("hops") or [],
                "hop_count": row.get("hop_count"),
                "nodes": nodes,
            })
            continue

        ids = _list(row.get("retrieved_chunk_ids"))
        distances = _list(row.get("retrieval_scores"))
        reranks = _list(row.get("rerank_scores"))
        origins = _list(row.get("retrieved_origins"))
        held = {c["chunk_id"]: c for c in corpus_store.chunks_by_id([str(i) for i in ids])}
        chunks = []
        for rank, chunk_id in enumerate(ids):
            c = held.get(chunk_id) or {}
            label = label_of.get(chunk_id)
            chunks.append({
                "rank": rank + 1,
                "chunk_id": chunk_id,
                "missing": not c,
                "text": c.get("text"),
                "document": c.get("filename"),
                "document_title": c.get("document_title"),
                "source_type": c.get("source_type"),
                "page": c.get("page_number"),
                "section": c.get("section_title"),
                "ordinal": c.get("ordinal"),
                "tokens": c.get("token_estimate"),
                "distance": distances[rank] if rank < len(distances) else None,
                "rerank_score": reranks[rank] if rank < len(reranks) else None,
                # As logged at query time; the document's origin today otherwise.
                "origin": (origins[rank] if rank < len(origins) else None) or c.get("origin"),
                "chunking": {
                    "strategy": c.get("chunk_strategy"),
                    "size": c.get("chunk_size"),
                    "overlap": c.get("chunk_overlap"),
                    "embedding_model": c.get("run_embedding_model") or c.get("embedding_model"),
                } if c else None,
                "label": label,
                "cited": bool(label and label in cited),
            })
        out.append({**base, "chunks": chunks, "documents": sorted({c["document"] for c in chunks if c["document"]})})

    return {"query_id": query_id, "retrievals": out}
