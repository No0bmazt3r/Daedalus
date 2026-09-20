"""The ingestion pipeline — upload to vector, with every stage on the record.

`architecture/04` Steps 1-6, run as one orchestrated job:

    store bytes → extract text → chunk → embed → write to Chroma → stamp

Each stage writes to `ingest_events` as it goes, so a run that produced nothing
can say which stage produced nothing and why. `MODULES.md` §0 rule 4 applied to a
pipeline: an empty corpus and an empty corpus *because the embedding model was
never pulled* are different facts, and only one of them is a bug.

## Why this is synchronous

An ingest is an operator action with somebody watching, not a request path. It
runs in a worker thread so the event loop stays free, and the UI follows it by
polling the run row — which it would have to do anyway across a reload, and which
means progress survives the browser being closed. A task queue would add a
dependency and a second place for state to live, to solve a problem that a row
already solves.

## Embeddings are computed here, not by Chroma

Chroma will happily embed text for you with its own bundled model. That would be
catastrophic here: the vectors would come from ONNX MiniLM while
`embedding_config.json` claims `nomic-embed-text`, the stamp would say one thing
and the index hold another, and every similarity score would be meaningless in a
way nothing on screen could show. So every vector is produced by
`ollama_client.embed` under the selected model, passed to Chroma explicitly, and
the collection is stamped with the model that actually did it.

The same applies at query time, which is why `search_corpus` embeds its query
through this module's `embed_query` rather than passing `query_texts`.

## Failure is partial, and recorded as such

A run embeds in batches and records the outcome per chunk. If chunk 400 of 900
fails, the first 399 keep their vectors, the rest stay `embedded = 0`, and
`resume` picks up exactly those. Rolling the whole run back would throw away
minutes of correct work because of one bad row; leaving it unrecorded would
produce a corpus that claims to be complete.
"""

from __future__ import annotations

import hashlib
import threading
from datetime import datetime, timezone
from typing import Any, Callable

from ..db import corpus_store, paths, vector_store
from . import chunking, corpus_config, embedding_models, extraction, ollama_client

# How many chunks to embed between progress writes. Small enough that the UI
# moves, large enough that the run is not dominated by SQLite round trips.
BATCH = 16

# One ingest at a time. Two concurrent runs over the same document would race on
# `replace_chunks` and could leave Chroma holding vectors for chunk ids that no
# longer exist — the one inconsistency this schema cannot detect afterwards.
_run_lock = threading.Lock()
_active: dict[str, Any] = {"run_id": None}


class IngestionError(RuntimeError):
    """The run cannot start. Distinct from a stage failing inside a run."""


def active_run() -> str | None:
    return _active["run_id"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def content_hash(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


# ── upload ───────────────────────────────────────────────────────────────────


def store_upload(
    raw: bytes,
    filename: str,
    *,
    source_type: str = "other",
    title: str | None = None,
    document_version: str | None = None,
    reactor_mode: str | None = None,
) -> dict[str, Any]:
    """Keep the bytes, record the document, and extract its text immediately.

    Extraction runs on upload rather than at ingest so a file that cannot be read
    is rejected while the person who chose it is still looking at the screen.
    The document row is written either way: a failed extraction is a state worth
    listing, and a parser fix should be able to make it retroactive without
    asking anybody to find the file again.
    """
    if not raw:
        raise IngestionError("the upload is empty")
    filename = (filename or "document").strip().replace("/", "_").replace("\\", "_")

    digest = content_hash(raw)
    existing = corpus_store.document_by_hash(digest)
    if existing:
        raise IngestionError(
            f"this file is already in the corpus as {existing['filename']!r} "
            f"(uploaded {existing['uploaded_at']}). Ingesting the same bytes twice "
            "doubles that document's weight in every retrieval."
        )

    document_id = corpus_store.new_id("doc")
    suffix = filename[filename.rfind("."):] if "." in filename else ""
    stored_name = f"{document_id}{suffix}"

    paths.CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    (paths.CORPUS_DIR / stored_name).write_bytes(raw)

    corpus_store.add_document(
        document_id=document_id,
        filename=filename,
        stored_name=stored_name,
        content_hash=digest,
        media_type=extraction.media_type_for(filename),
        size_bytes=len(raw),
        source_type=source_type,
        title=title or filename,
        document_version=document_version,
        reactor_mode=reactor_mode,
    )

    try:
        result = extraction.extract(raw, filename)
    except extraction.ExtractionError as exc:
        corpus_store.set_extraction(document_id, status="failed", error=str(exc))
        return {**(corpus_store.get_document(document_id) or {}), "extract_error": str(exc)}

    corpus_store.set_extraction(
        document_id,
        status="ok",
        extractor=result.extractor,
        page_count=result.page_count,
        char_count=len(result.text),
    )
    return corpus_store.get_document(document_id) or {}


def read_text(document: dict[str, Any]) -> extraction.Extracted:
    """Re-extract from the stored bytes.

    Always from the original, never from a cached extraction. The bytes are the
    only artefact that cannot be regenerated, and re-reading them is what makes a
    parser improvement apply to documents uploaded before it.
    """
    path = paths.CORPUS_DIR / document["stored_name"]
    if not path.exists():
        raise IngestionError(
            f"{document['filename']}'s stored copy is missing from {paths.CORPUS_DIR}. "
            "The row survived but the bytes did not — delete the document and upload it again."
        )
    return extraction.extract(path.read_bytes(), document["filename"])


# ── preview ──────────────────────────────────────────────────────────────────


def preview(
    document_id: str, *, strategy: str, chunk_size: int, chunk_overlap: int, limit: int = 12
) -> dict[str, Any]:
    """Chunk a document without writing anything.

    The whole reason `chunking` has no I/O. Adjusting size or overlap and seeing
    where the splits land should cost a parse, not an embedding run — and this
    returns the totals for the *whole* document alongside the first few chunks,
    so the number that matters (how many vectors this will produce) is honest
    even though the list is truncated.
    """
    document = corpus_store.get_document(document_id)
    if not document:
        raise IngestionError(f"no document {document_id!r}")
    if document["extract_status"] != "ok":
        raise IngestionError(
            f"{document['filename']} has no extracted text: {document['extract_error'] or 'not parsed yet'}"
        )

    extracted = read_text(document)
    chunks = chunking.chunk_text(
        extracted.text,
        size=chunk_size,
        overlap=chunk_overlap,
        strategy=strategy,
        page_breaks=extracted.page_breaks,
    )
    sizes = [len(c.text) for c in chunks] or [0]
    return {
        "document_id": document_id,
        "filename": document["filename"],
        "settings": {"strategy": strategy, "chunk_size": chunk_size, "chunk_overlap": chunk_overlap},
        "total_chunks": len(chunks),
        "total_chars": len(extracted.text),
        "size_min": min(sizes),
        "size_max": max(sizes),
        "size_avg": sum(sizes) // len(sizes),
        "token_estimate_total": sum(c.token_estimate for c in chunks),
        "chunks": [c.as_dict() for c in chunks[:limit]],
        "truncated": len(chunks) > limit,
        "extraction": extracted.as_dict(),
    }


# ── embedding ────────────────────────────────────────────────────────────────


def _embedding_target() -> tuple[str, str]:
    """The model a run must embed with, and the collection it owns.

    `resolve_for_runtime` is what refuses a cloud embedding model: Rule 1 permits
    cloud chat as an evaluation baseline, but cloud *embedding* sends the entire
    corpus and every future query off the machine, so it is never the production
    path. A cloud baseline index is built deliberately, through its own
    collection, not by an ingest that did not mention it.
    """
    config = embedding_models.resolve_for_runtime()
    model = embedding_models.normalise_tag(config["model"])
    return model, embedding_models.collection_for(config)


def embed_query(text: str) -> list[float]:
    """One vector for a query, from the same model the index was built with.

    Exists so `search_corpus` never passes `query_texts` to Chroma. That call
    looks harmless and quietly embeds with Chroma's own bundled model, comparing
    a MiniLM query vector against nomic document vectors — which does not error,
    does not return nothing, and ranks by noise.
    """
    model, _ = _embedding_target()
    return ollama_client.embed(model, text)


def _embed_batch(model: str, texts: list[str]) -> list[list[float]]:
    return [ollama_client.embed(model, text) for text in texts]


# ── the run ──────────────────────────────────────────────────────────────────


def ingest(
    document_ids: list[str] | None = None,
    *,
    kind: str = "ingest",
    settings: dict[str, Any] | None = None,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Chunk and embed documents, writing progress as it goes.

    `document_ids` of None means every document whose text extracted cleanly —
    the "ingest everything" button. A document that failed extraction is skipped
    with an event rather than failing the run, because one unparseable file
    should not stop the other nine being indexed.
    """
    if not _run_lock.acquire(blocking=False):
        raise IngestionError(
            f"an ingest is already running ({_active['run_id']}). Wait for it to finish — "
            "two runs over one document would race on its chunks."
        )

    run_id = corpus_store.new_id("run")
    try:
        _active["run_id"] = run_id
        return _run(run_id, document_ids, kind=kind, settings=settings, on_progress=on_progress)
    finally:
        _active["run_id"] = None
        _run_lock.release()


def _run(
    run_id: str,
    document_ids: list[str] | None,
    *,
    kind: str,
    settings: dict[str, Any] | None,
    on_progress: Callable[[dict[str, Any]], None] | None,
) -> dict[str, Any]:
    chosen = settings or corpus_config.read()
    try:
        size, overlap, strategy = chunking.validate(
            chosen["chunk_size"], chosen["chunk_overlap"], chosen["strategy"]
        )
    except chunking.ChunkingError as exc:
        raise IngestionError(str(exc)) from exc

    # Resolved before the run row is written, so a run that could never have
    # embedded is refused rather than recorded as a failure with no vectors.
    try:
        model, collection_name = _embedding_target()
    except embedding_models.NotProductionSafe as exc:
        raise IngestionError(str(exc)) from exc

    documents = [
        d for d in corpus_store.list_documents()
        if document_ids is None or d["document_id"] in set(document_ids)
    ]
    if not documents:
        raise IngestionError("no documents to ingest — upload one first")

    corpus_store.start_run(
        run_id=run_id, kind=kind, strategy=strategy, chunk_size=size, chunk_overlap=overlap,
        embedding_model=model, collection=collection_name, documents_total=len(documents),
    )
    corpus_store.log(
        run_id, "queued",
        f"{len(documents)} document(s) · {strategy} · size {size} · overlap {overlap} · {model}",
        detail={"documents": [d["filename"] for d in documents]},
    )

    if not ollama_client.available():
        message = (
            "Ollama is not reachable, so nothing can be embedded. Chunks will still be "
            "written and can be embedded later with Resume."
        )
        corpus_store.log(run_id, "embed", message, level="warn")

    chunks_written = vectors_written = documents_done = 0
    failures: list[str] = []

    for document in documents:
        document_id = document["document_id"]
        name = document["filename"]

        if document["extract_status"] != "ok":
            corpus_store.log(
                run_id, "extract", f"skipped {name}: {document['extract_error'] or 'never parsed'}",
                level="warn", document_id=document_id,
            )
            documents_done += 1
            continue

        # ── extract ──
        corpus_store.update_run(run_id, stage="extract")
        try:
            extracted = read_text(document)
        except (IngestionError, extraction.ExtractionError) as exc:
            corpus_store.set_extraction(document_id, status="failed", error=str(exc))
            corpus_store.log(run_id, "extract", f"{name}: {exc}", level="error", document_id=document_id)
            failures.append(name)
            documents_done += 1
            continue
        corpus_store.log(
            run_id, "extract", f"{name}: {len(extracted.text)} chars", level="debug",
            document_id=document_id, detail=extracted.as_dict(),
        )
        for warning in extracted.warnings:
            corpus_store.log(run_id, "extract", f"{name}: {warning}", level="warn", document_id=document_id)

        # ── chunk ──
        corpus_store.update_run(run_id, stage="chunk")
        pieces = chunking.chunk_text(
            extracted.text, size=size, overlap=overlap, strategy=strategy,
            page_breaks=extracted.page_breaks,
        )
        if not pieces:
            corpus_store.log(run_id, "chunk", f"{name} produced no chunks", level="warn", document_id=document_id)
            documents_done += 1
            continue

        rows = [{**c.as_dict(), "chunk_id": f"{document_id}:{c.ordinal:05d}"} for c in pieces]
        stale = corpus_store.replace_chunks(document_id, rows, run_id=run_id)
        chunks_written += len(rows)
        corpus_store.log(
            run_id, "chunk", f"{name}: {len(rows)} chunks", document_id=document_id,
            detail={"replaced": len(stale), "avg_chars": sum(len(r["text"]) for r in rows) // len(rows)},
        )

        # Vectors for boundaries that no longer exist must go, or retrieval keeps
        # returning chunks whose text is no longer in the manifest.
        if stale:
            _drop_vectors(run_id, collection_name, stale)

        # ── embed ──
        corpus_store.update_run(
            run_id, stage="embed", chunks_written=chunks_written, documents_done=documents_done,
        )
        embedded = _embed_document(
            run_id, document_id, name, rows, model=model, collection_name=collection_name
        )
        vectors_written += embedded
        if embedded < len(rows):
            failures.append(name)

        documents_done += 1
        corpus_store.update_run(
            run_id, documents_done=documents_done, chunks_written=chunks_written,
            vectors_written=vectors_written,
        )
        if on_progress:
            on_progress(corpus_store.get_run(run_id) or {})

    # ── stamp ──
    if vectors_written:
        try:
            vector_store.stamp_index(
                collection_name, model=model,
                dimensions=embedding_models.effective_dimensions(model), at=_now(),
            )
            embedding_models.record_index(model=model, collection=collection_name)
            corpus_store.log(run_id, "stamp", f"{collection_name} stamped as {model}")
        except Exception as exc:  # noqa: BLE001 — an unstamped index is refused, not silent
            corpus_store.log(
                run_id, "stamp",
                f"could not stamp {collection_name}: {exc}. The index will be refused at query "
                "time until it is stamped — re-run the ingest.",
                level="error",
            )
            failures.append("stamp")

    status = "ok" if not failures else "failed"
    corpus_store.finish_run(
        run_id, status=status,
        error=None if not failures else f"incomplete: {', '.join(sorted(set(failures)))}",
    )
    corpus_store.log(
        run_id, "complete",
        f"{documents_done} document(s) · {chunks_written} chunks · {vectors_written} vectors",
        level="info" if not failures else "warn",
    )
    return corpus_store.get_run(run_id) or {}


def _embed_document(
    run_id: str, document_id: str, name: str, rows: list[dict[str, Any]],
    *, model: str, collection_name: str,
) -> int:
    """Embed one document's chunks in batches. Returns how many landed."""
    try:
        collection = vector_store.get_collection(collection_name, require_match=False, create=True)
    except Exception as exc:  # noqa: BLE001
        collection = None
        corpus_store.log(run_id, "embed", f"vector store unavailable: {exc}", level="error",
                         document_id=document_id)
    if collection is None:
        corpus_store.log(
            run_id, "embed",
            f"{name}: chunks written but not embedded — the vector store is unreachable. "
            "Resume this run once it is back.",
            level="error", document_id=document_id,
        )
        return 0

    document = corpus_store.get_document(document_id) or {}
    landed = 0
    for start in range(0, len(rows), BATCH):
        batch = rows[start:start + BATCH]
        ids = [r["chunk_id"] for r in batch]
        texts = [r["text"] for r in batch]
        try:
            vectors = _embed_batch(model, texts)
            collection.upsert(
                ids=ids,
                documents=texts,
                embeddings=vectors,
                metadatas=[
                    {
                        # The keys `search_corpus` filters and cites on. Chroma
                        # metadata holds primitives only, and a None value is
                        # rejected outright — hence the empty-string fallbacks.
                        "document_id": document_id,
                        "source_file": document.get("filename") or "",
                        "source_type": document.get("source_type") or "other",
                        "document_version": document.get("document_version") or "",
                        "reactor_mode": document.get("reactor_mode") or "",
                        "section_title": r.get("section_title") or "",
                        "page_number": int(r["page_number"]) if r.get("page_number") else 0,
                        "ordinal": int(r["ordinal"]),
                    }
                    for r in batch
                ],
            )
            corpus_store.mark_embedded(ids, model=model, collection=collection_name)
            landed += len(ids)
        except Exception as exc:  # noqa: BLE001 — one batch failing is not the run failing
            corpus_store.mark_embedded(ids, model=model, collection=collection_name, error=str(exc))
            corpus_store.log(
                run_id, "embed",
                f"{name}: chunks {batch[0]['ordinal']}-{batch[-1]['ordinal']} failed: {exc}",
                level="error", document_id=document_id,
            )
    corpus_store.log(
        run_id, "embed", f"{name}: {landed}/{len(rows)} vectors",
        level="info" if landed == len(rows) else "warn", document_id=document_id,
    )
    return landed


def _drop_vectors(run_id: str, collection_name: str, ids: list[str]) -> None:
    try:
        collection = vector_store.get_collection(collection_name, require_match=False, create=False)
        if collection is not None:
            collection.delete(ids=ids)
            corpus_store.log(run_id, "chunk", f"dropped {len(ids)} superseded vectors", level="debug")
    except Exception as exc:  # noqa: BLE001
        corpus_store.log(
            run_id, "chunk",
            f"could not drop {len(ids)} superseded vectors: {exc}. They are orphaned in "
            f"{collection_name} and will be returned by retrieval until it is rebuilt.",
            level="error",
        )


def resume(document_id: str | None = None) -> dict[str, Any]:
    """Embed the chunks that have no vector, without re-chunking anything.

    The other half of partial failure. A run that died at the embed stage — the
    embedding model was not pulled, Ollama was restarting, Chroma was down — left
    correct chunks behind, and re-running the whole ingest would throw them away
    and re-derive them identically. This picks up exactly the `embedded = 0` rows.

    It is also what a model swap needs, once `reembed_all` has cleared the flags:
    the text never changed, so re-parsing every PDF to reach it would be work
    done twice for no different answer.
    """
    if not _run_lock.acquire(blocking=False):
        raise IngestionError(f"an ingest is already running ({_active['run_id']})")

    run_id = corpus_store.new_id("run")
    try:
        _active["run_id"] = run_id
        pending = corpus_store.pending_chunks(document_id)
        if not pending:
            raise IngestionError(
                "every chunk already has a vector — nothing to resume. Re-ingest if you "
                "want different chunk boundaries."
            )

        settings = corpus_config.read()
        model, collection_name = _embedding_target()
        corpus_store.start_run(
            run_id=run_id, kind="reembed", strategy=settings["strategy"],
            chunk_size=settings["chunk_size"], chunk_overlap=settings["chunk_overlap"],
            embedding_model=model, collection=collection_name,
            documents_total=len({c["document_id"] for c in pending}),
        )
        corpus_store.log(
            run_id, "queued", f"resuming {len(pending)} unembedded chunk(s) with {model}"
        )

        by_document: dict[str, list[dict[str, Any]]] = {}
        for chunk in pending:
            by_document.setdefault(chunk["document_id"], []).append(chunk)

        landed = done = 0
        failures: list[str] = []
        corpus_store.update_run(run_id, stage="embed")
        for doc_id, rows in by_document.items():
            document = corpus_store.get_document(doc_id) or {}
            name = document.get("filename", doc_id)
            got = _embed_document(
                run_id, doc_id, name, rows, model=model, collection_name=collection_name
            )
            landed += got
            done += 1
            if got < len(rows):
                failures.append(name)
            corpus_store.update_run(run_id, documents_done=done, vectors_written=landed)

        if landed:
            try:
                vector_store.stamp_index(
                    collection_name, model=model,
                    dimensions=embedding_models.effective_dimensions(model), at=_now(),
                )
                embedding_models.record_index(model=model, collection=collection_name)
                corpus_store.log(run_id, "stamp", f"{collection_name} stamped as {model}")
            except Exception as exc:  # noqa: BLE001
                corpus_store.log(run_id, "stamp", f"could not stamp: {exc}", level="error")
                failures.append("stamp")

        status_value = "ok" if not failures else "failed"
        corpus_store.finish_run(
            run_id, status=status_value,
            error=None if not failures else f"incomplete: {', '.join(sorted(set(failures)))}",
        )
        corpus_store.log(
            run_id, "complete", f"{landed}/{len(pending)} vectors",
            level="info" if not failures else "warn",
        )
        return corpus_store.get_run(run_id) or {}
    finally:
        _active["run_id"] = None
        _run_lock.release()


def clear_vectors() -> dict[str, Any]:
    """Drop every vector and mark every chunk unembedded, keeping the text.

    What a change of embedding model requires. The old vectors are not merely
    stale, they are *unusable*: a different model means a different vector space,
    and `vector_store.mismatch` refuses the collection rather than ranking across
    two of them. Clearing is therefore not cleanup, it is the first half of the
    swap — and it deliberately does not re-embed, because the new model may not
    be pulled yet and failing here would leave the corpus in neither state.
    """
    ids = corpus_store.all_chunk_ids()
    problem = drop_document_vectors(ids)
    corpus_store.clear_embed_state()
    return {"cleared": len(ids), "warning": problem}


def drop_document_vectors(chunk_ids: list[str]) -> str | None:
    """Delete a removed document's vectors. Returns a problem, or None.

    Called by the delete endpoint after the rows are gone. Errors are returned
    rather than raised: the document *is* deleted at that point, and failing the
    request would say otherwise.
    """
    if not chunk_ids:
        return None
    try:
        _, collection_name = _embedding_target()
        collection = vector_store.get_collection(collection_name, require_match=False, create=False)
        if collection is None:
            return "the vector store is unreachable, so the vectors are still indexed"
        collection.delete(ids=chunk_ids)
        return None
    except Exception as exc:  # noqa: BLE001
        return f"the document is deleted but its vectors remain: {exc}"


def status() -> dict[str, Any]:
    """Everything the corpus panel needs in one call."""
    index = embedding_models.index_state()
    # `index_state` describes the *index*, not the selection — it carries no
    # model key, and reading one from it silently reported "no embedding model"
    # on a machine that had one configured. The selection comes from `read()`.
    try:
        selected = embedding_models.read().get("model")
    except Exception:  # noqa: BLE001 — a status call reports, never raises
        selected = None
    return {
        "corpus": corpus_store.stats(),
        "settings": corpus_config.status(),
        "extraction": extraction.status(),
        "embedding": {
            "model": selected,
            "index_state": index.get("index_state"),
            "index_detail": index.get("index_detail"),
            "collection": index.get("collection"),
            "ollama_available": ollama_client.available(),
        },
        "active_run": active_run(),
        "runs": corpus_store.list_runs(limit=10),
    }
