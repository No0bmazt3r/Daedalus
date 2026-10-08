"""Track 1 retrieval replay for Labyrinth Blueprints — what a vector query pulled.

Vector retrievals, newest first — Track 1's counterpart to `/graph/traversals`.

The comparison in `PROJECT.md` §10 needs both arms to be inspectable the same
way, and until this existed only Track 2 was: you could replay a graph walk
hop by hop and had no way at all to see which chunks a vector query pulled.
An arm you cannot audit cannot be defended as grounded, whatever its numbers.

Read from `rag_logs`, never re-run. Re-querying would show what the index
returns *today* rather than what produced that answer, and Layer 10 has one
source of truth.

## `replay()`

What one vector query actually retrieved: chunks, distances, sources.

## The chunk text is joined, and may be missing

`rag_logs` records chunk *ids*; the text lives in the corpus manifest. They
are joined here rather than duplicated into the log, because a log that
copied the text would be a second copy to keep true — and re-chunking would
make it a copy of something that no longer exists.

The join can miss, and that is reported rather than hidden: a chunk
retrieved before a re-ingest has an id nothing holds any more. `missing:
true` on that row is a real finding — it says this answer was grounded in a
passage the corpus can no longer produce, which is exactly the kind of thing
an evaluation needs to know about rather than see silently dropped.

## Distances are shown as stored

Cosine distance from Chroma, never converted to a similarity percentage. A
reader has to be able to check the number against the store, and a converted
figure quietly becomes a different claim.
"""

from __future__ import annotations

import json
from typing import Any

from ..db import audit_store, corpus_store


def recent(limit: int) -> dict[str, Any]:
    """Vector retrievals, newest first — Track 1's counterpart to `/graph/traversals`."""
    rows = audit_store.vector_retrievals(limit)
    return {"available": True, "retrievals": rows, "total": len(rows)}


def replay(query_id: str) -> dict[str, Any]:
    """One vector query's chunks, distances and sources, joined from the corpus."""
    row = audit_store.latest_vector_retrieval(query_id)
    if row is None:
        return {
            "available": False,
            "reason": f"no vector retrieval recorded for {query_id!r}",
        }

    def _parse(value: Any) -> list[Any]:
        if not value:
            return []
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return []
        return parsed if isinstance(parsed, list) else []

    ids = _parse(row["retrieved_chunk_ids"])
    scores = _parse(row["retrieval_scores"])
    stored = {c["chunk_id"]: c for c in corpus_store.chunks_by_id(ids)}

    chunks = []
    for rank, chunk_id in enumerate(ids):
        held = stored.get(chunk_id)
        chunks.append({
            "rank": rank + 1,
            "chunk_id": chunk_id,
            "distance": scores[rank] if rank < len(scores) else None,
            "missing": held is None,
            "text": (held or {}).get("text"),
            "source_file": (held or {}).get("filename"),
            "source_type": (held or {}).get("source_type"),
            "page_number": (held or {}).get("page_number"),
            "section_title": (held or {}).get("section_title"),
            "ordinal": (held or {}).get("ordinal"),
        })

    return {
        "available": True,
        "query_id": row["query_id"],
        "timestamp": row["timestamp"],
        "track": "vector",
        "query_text": row["query_text"],
        "top_k": row["top_k"],
        "collection": row["vector_db_used"],
        "retrieval_latency_ms": row["retrieval_latency_ms"],
        "source_files": _parse(row["source_files"]),
        "chunks": chunks,
        "missing_count": sum(1 for c in chunks if c["missing"]),
    }
