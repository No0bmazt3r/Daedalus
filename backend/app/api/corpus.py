"""The corpus pipeline — `/api/corpus` (MODULES.md §3.1, architecture/04).

Upload, chunk, embed, inspect, debug. The half of Labyrinth Blueprints that was
an honest empty state until now.

## Upload takes a raw body, not multipart

`UploadFile` needs `python-multipart`, and a document upload does not need a
form: there is exactly one file per request and its metadata fits in the query
string. Sending the bytes as the body keeps a dependency out of the image and
makes the endpoint trivial to drive from `curl`, which matters for a pipeline
somebody will want to script over a folder of manuals.

## Nothing here is a runtime tool

Rule 5. Ingesting writes — to the corpus store, to the filesystem and to
Chroma — so every route here is a *setup* surface, reachable from Settings and
Blueprints and never exposed to the model. The registry has no `ingest_document`
tool and must not grow one: a model that could add to its own knowledge base
could add something nobody reviewed.

## Long runs answer immediately

`POST /ingest` starts the run in a worker thread and returns the run row. The UI
polls `/runs/{id}`, which is what it would have to do across a page reload
anyway — and it means closing the browser does not abandon an ingest halfway
through a corpus.
"""

from __future__ import annotations

import threading
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request

from ..db import corpus_store
from ..services import chunking, corpus_config, extraction, ingestion

router = APIRouter(prefix="/api/corpus", tags=["corpus"])

# Generous for a manual, small enough that a mis-aimed `curl` cannot fill the
# disk before the check runs.
MAX_UPLOAD_BYTES = 64 * 1024 * 1024

SOURCE_TYPES = ("manual", "sop", "anomaly_record", "uauc_record", "other")


@router.get("/status")
def status() -> dict[str, Any]:
    """Everything the corpus panel renders from — totals, settings, readiness."""
    return ingestion.status()


# ── documents ────────────────────────────────────────────────────────────────


@router.get("/documents")
def list_documents() -> dict[str, Any]:
    """Every document with its chunk and vector counts.

    `available: true` unconditionally — this is what replaced the M2 blocked
    stub, and an empty corpus is now an empty corpus rather than an unbuilt
    feature. The shape keeps the `available` flag the client already branches on.
    """
    documents = corpus_store.list_documents()
    return {
        "available": True,
        "documents": documents,
        "total": len(documents),
        "extraction": extraction.status(),
    }


@router.post("/documents")
async def upload_document(
    request: Request,
    filename: str = Query(..., description="The original filename, with its extension."),
    source_type: str = Query("other"),
    title: str | None = Query(None),
    document_version: str | None = Query(None),
    reactor_mode: str | None = Query(None),
) -> dict[str, Any]:
    """Store one document and extract its text. The body is the raw file.

    Extraction runs now rather than at ingest, so an unreadable file is refused
    while the person who picked it is still looking at the screen. The row is
    written either way — see `ingestion.store_upload` for why a failed
    extraction is kept rather than discarded.
    """
    if source_type not in SOURCE_TYPES:
        raise HTTPException(400, f"source_type must be one of {', '.join(SOURCE_TYPES)}")

    raw = await request.body()
    if not raw:
        raise HTTPException(400, "the request body is empty — send the file as the body")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            413, f"{len(raw) // 1024 // 1024}MB exceeds the {MAX_UPLOAD_BYTES // 1024 // 1024}MB limit"
        )

    try:
        document = ingestion.store_upload(
            raw, filename, source_type=source_type, title=title,
            document_version=document_version, reactor_mode=reactor_mode,
        )
    except ingestion.IngestionError as exc:
        # 409 rather than 400: a duplicate is not a malformed request, and the
        # client shows it as "already here" rather than as a validation error.
        raise HTTPException(409, str(exc)) from exc
    return {"document": document}


@router.get("/documents/{document_id}")
def get_document(document_id: str) -> dict[str, Any]:
    document = corpus_store.get_document(document_id)
    if not document:
        raise HTTPException(404, f"no document {document_id!r}")
    return {"document": document}


@router.patch("/documents/{document_id}")
def update_document(document_id: str, fields: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Edit the metadata retrieval filters on.

    Does not re-index. The values are copied onto each vector's metadata at
    embed time, so changing `source_type` here and expecting `search_corpus` to
    filter by the new value needs a re-ingest — which the response says rather
    than leaving it to be discovered.
    """
    if not corpus_store.get_document(document_id):
        raise HTTPException(404, f"no document {document_id!r}")
    if fields.get("source_type") and fields["source_type"] not in SOURCE_TYPES:
        raise HTTPException(400, f"source_type must be one of {', '.join(SOURCE_TYPES)}")
    try:
        document = corpus_store.update_document(document_id, **fields)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "document": document,
        "note": "Vector metadata carries the old values until this document is re-ingested.",
    }


@router.delete("/documents/{document_id}")
def delete_document(document_id: str) -> dict[str, Any]:
    """Remove a document, its chunks and its vectors.

    The chunk ids come back from the delete so the vectors can be dropped too —
    Chroma does not cascade, and after the rows are gone nothing knows which
    vectors belonged to it.
    """
    if not corpus_store.get_document(document_id):
        raise HTTPException(404, f"no document {document_id!r}")
    chunk_ids = corpus_store.delete_document(document_id)
    problem = ingestion.drop_document_vectors(chunk_ids)
    return {"deleted": document_id, "chunks_removed": len(chunk_ids), "warning": problem}


@router.get("/documents/{document_id}/chunks")
def document_chunks(
    document_id: str, limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0)
) -> dict[str, Any]:
    """The chunks as the retriever sees them — text, offsets, page, embed state."""
    if not corpus_store.get_document(document_id):
        raise HTTPException(404, f"no document {document_id!r}")
    return {"available": True, **corpus_store.list_chunks(document_id, limit=limit, offset=offset)}


# ── settings and preview ─────────────────────────────────────────────────────


@router.get("/config")
def get_config() -> dict[str, Any]:
    """Chunk settings, the strategies and their bounds."""
    return corpus_config.status()


@router.put("/config")
def set_config(
    strategy: str = Body(...), chunk_size: int = Body(...), chunk_overlap: int = Body(...),
) -> dict[str, Any]:
    """Commit chunk settings. Not retroactive — see `corpus_config`."""
    try:
        corpus_config.write(
            strategy=strategy, chunk_size=chunk_size, chunk_overlap=chunk_overlap
        )
    except chunking.ChunkingError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        **corpus_config.status(),
        "note": "Existing chunks keep the boundaries they were written with. Re-ingest to apply this.",
    }


@router.post("/preview")
def preview(
    document_id: str = Body(...),
    strategy: str = Body(None),
    chunk_size: int = Body(None),
    chunk_overlap: int = Body(None),
    limit: int = Body(12),
) -> dict[str, Any]:
    """Chunk a document with these settings and write nothing.

    The point of the whole `chunking` module having no I/O. Omitted settings fall
    back to the committed ones, so the panel can preview the current recipe
    without restating it.
    """
    current = corpus_config.read()
    try:
        return ingestion.preview(
            document_id,
            strategy=strategy or current["strategy"],
            chunk_size=chunk_size or current["chunk_size"],
            chunk_overlap=chunk_overlap if chunk_overlap is not None else current["chunk_overlap"],
            limit=max(1, min(int(limit), 50)),
        )
    except chunking.ChunkingError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ingestion.IngestionError as exc:
        raise HTTPException(404, str(exc)) from exc
    except extraction.ExtractionError as exc:
        raise HTTPException(422, str(exc)) from exc


# ── runs ─────────────────────────────────────────────────────────────────────


@router.post("/ingest")
def start_ingest(
    document_ids: list[str] | None = Body(None),
    strategy: str = Body(None),
    chunk_size: int = Body(None),
    chunk_overlap: int = Body(None),
) -> dict[str, Any]:
    """Chunk and embed. Returns the run row; poll `/runs/{id}` for progress.

    Settings default to the committed ones. Passing them explicitly is how a
    one-off run with different boundaries happens without changing the config
    everything else reads — and the values are copied onto the run row, so the
    recipe stays recoverable either way.
    """
    current = corpus_config.read()
    settings = {
        "strategy": strategy or current["strategy"],
        "chunk_size": chunk_size or current["chunk_size"],
        "chunk_overlap": chunk_overlap if chunk_overlap is not None else current["chunk_overlap"],
    }

    started: dict[str, Any] = {}
    error: dict[str, Any] = {}
    ready = threading.Event()

    def work() -> None:
        try:
            # The run row exists before this returns, so the response can carry
            # it — the event is released by `_run` writing it, not by the run
            # finishing. Without this the client would get an id it cannot poll.
            ingestion.ingest(document_ids, settings=settings, on_progress=lambda r: _seen(r))
        except ingestion.IngestionError as exc:
            error["detail"] = str(exc)
            ready.set()
        except Exception as exc:  # noqa: BLE001 — a crashed worker must still release
            error["detail"] = f"the run failed to start: {exc}"
            ready.set()

    def _seen(run: dict[str, Any]) -> None:
        if not started:
            started.update(run)
            ready.set()

    thread = threading.Thread(target=work, name="corpus-ingest", daemon=True)
    thread.start()
    # Long enough for validation and the first document, short enough that a
    # large corpus does not hold the request open. Whichever happens first,
    # the client ends up with either a run id to poll or the reason there is none.
    ready.wait(timeout=8.0)

    if error:
        raise HTTPException(409, error["detail"])
    if started:
        return {"run": started}
    active = ingestion.active_run()
    if active:
        return {"run": corpus_store.get_run(active) or {"run_id": active, "status": "running"}}
    latest = corpus_store.list_runs(limit=1)
    return {"run": latest[0] if latest else {}, "note": "still starting — poll /api/corpus/runs"}


@router.post("/resume")
def resume(document_id: str | None = Body(None, embed=True)) -> dict[str, Any]:
    """Embed the chunks that have no vector. Does not re-chunk.

    Synchronous, unlike `/ingest`: a resume covers what one run already failed to
    embed, which is bounded and usually small. If it turns out not to be, the run
    row is written before the work starts and is pollable exactly like an ingest.
    """
    try:
        return {"run": ingestion.resume(document_id)}
    except ingestion.IngestionError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/clear-vectors")
def clear_vectors() -> dict[str, Any]:
    """Drop every vector, keep every chunk. The first half of an embedding swap.

    Separate from re-embedding on purpose: the new model may not be pulled yet,
    and a combined operation that failed halfway would leave the corpus in
    neither the old state nor the new one.
    """
    result = ingestion.clear_vectors()
    return {
        **result,
        "note": "Chunk text is kept. Run Resume to re-embed with the currently selected model.",
    }


# ── retrieval replay (Track 1's evidence) ────────────────────────────────────


@router.get("/retrievals")
def list_retrievals(limit: int = Query(50, ge=1, le=500)) -> dict[str, Any]:
    """Vector retrievals, newest first — Track 1's counterpart to `/graph/traversals`.

    The comparison in `PROJECT.md` §10 needs both arms to be inspectable the same
    way, and until this existed only Track 2 was: you could replay a graph walk
    hop by hop and had no way at all to see which chunks a vector query pulled.
    An arm you cannot audit cannot be defended as grounded, whatever its numbers.

    Read from `rag_logs`, never re-run. Re-querying would show what the index
    returns *today* rather than what produced that answer, and Layer 10 has one
    source of truth.
    """
    from ..db import audit_store, paths, sqlite_util  # noqa: PLC0415

    audit_store.init_db()
    with sqlite_util.connect(paths.AUDIT_DB, read_only=True) as conn:
        rows = conn.execute(
            "SELECT query_id, timestamp, query_text, top_k, retrieval_latency_ms, "
            "vector_db_used, retrieved_chunk_ids IS NOT NULL AS replayable "
            "FROM rag_logs WHERE track = 'vector' ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()

    return {
        "available": True,
        "retrievals": [{**dict(r), "replayable": bool(r["replayable"])} for r in rows],
        "total": len(rows),
    }


@router.get("/retrieval/{query_id}")
def get_retrieval(query_id: str) -> dict[str, Any]:
    """What one vector query actually retrieved: chunks, distances, sources.

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
    import json  # noqa: PLC0415

    from ..db import audit_store, paths, sqlite_util  # noqa: PLC0415

    audit_store.init_db()
    with sqlite_util.connect(paths.AUDIT_DB, read_only=True) as conn:
        row = conn.execute(
            "SELECT * FROM rag_logs WHERE query_id = ? AND track = 'vector' "
            "ORDER BY id DESC LIMIT 1",
            (query_id,),
        ).fetchone()

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


@router.get("/runs")
def list_runs(limit: int = Query(30, ge=1, le=200)) -> dict[str, Any]:
    return {"runs": corpus_store.list_runs(limit), "active_run": ingestion.active_run()}


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    run = corpus_store.get_run(run_id)
    if not run:
        raise HTTPException(404, f"no run {run_id!r}")
    return {"run": run, "active": ingestion.active_run() == run_id}


@router.get("/runs/{run_id}/events")
def run_events(
    run_id: str,
    level: str | None = Query(None, description="debug · info · warn · error"),
    limit: int = Query(500, ge=1, le=5000),
) -> dict[str, Any]:
    """The pipeline's own log for one run — the debugging surface."""
    if not corpus_store.get_run(run_id):
        raise HTTPException(404, f"no run {run_id!r}")
    if level and level not in ("debug", "info", "warn", "error"):
        raise HTTPException(400, "level must be one of debug, info, warn, error")
    return {"run_id": run_id, "events": corpus_store.events(run_id, level=level, limit=limit)}
