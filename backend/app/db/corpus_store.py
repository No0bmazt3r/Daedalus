"""The corpus manifest — documents, chunks, runs and the pipeline's own log.

The relational half of the Vector store. Chroma holds the vectors; this holds
the record of what was ingested, under what settings, and what happened while it
was. See `paths.CORPUS_DB` for why it is filed under the Vector store rather
than counted as a sixth one, and `migrations/corpus/001_initial_schema.sql` for
why chunk text lives here as well as in Chroma.

## Everything here is synchronous and small

Ingestion is an operator action measured in seconds, not a request path measured
in milliseconds, so there is no connection pool and no async: one connection per
call through `sqlite_util.connect`, which already carries WAL, the busy timeout
and the retry. The one concession to volume is `add_chunks`, which writes a run's
chunks in a single transaction — a thousand separate commits is the difference
between an ingest that takes two seconds and one that takes ninety.

## Why the log lives beside the data it describes

`ingest_events` is in this database rather than in `audit` on purpose. Audit rows
are append-only evidence that an *answer* was grounded, and the evaluation
chapter rests on them never being deleted. Pipeline logs are operational: they
belong to the document, and deleting a document should take its history with it.
Putting them in `audit` would mean either orphaned evidence or a DELETE reaching
into the one store whose value is that nothing ever deletes from it.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from . import paths, sqlite_util


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    """A readable, sortable id. Time first so a directory listing is chronological."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{stamp}_{uuid.uuid4().hex[:8]}"


def _connect() -> Any:
    return sqlite_util.connect(paths.CORPUS_DB)


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


# ── documents ────────────────────────────────────────────────────────────────


def add_document(
    *,
    document_id: str,
    filename: str,
    stored_name: str,
    content_hash: str,
    media_type: str,
    size_bytes: int,
    source_type: str = "other",
    title: str | None = None,
    document_version: str | None = None,
    reactor_mode: str | None = None,
) -> dict[str, Any]:
    now = _now()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO documents (
                document_id, filename, stored_name, content_hash, media_type, size_bytes,
                source_type, title, document_version, reactor_mode, uploaded_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                document_id, filename, stored_name, content_hash, media_type, size_bytes,
                source_type, title, document_version, reactor_mode, now, now,
            ),
        )
    return get_document(document_id) or {}


def document_by_hash(content_hash: str) -> dict[str, Any] | None:
    """The duplicate check. Content, not filename — the same manual renamed is
    still the same manual, and ingesting it twice doubles its weight in every
    retrieval without anything on screen to say so."""
    with _connect() as conn:
        return _row(
            conn.execute(
                "SELECT * FROM documents WHERE content_hash = ?", (content_hash,)
            ).fetchone()
        )


def get_document(document_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        return _row(
            conn.execute(
                "SELECT * FROM documents WHERE document_id = ?", (document_id,)
            ).fetchone()
        )


def list_documents() -> list[dict[str, Any]]:
    """Every document with its chunk and vector counts.

    The counts are computed here rather than kept on the document row. A stored
    counter has to be right after every partial run, every delete and every
    re-embed, and the corpus is tens of documents — the join is free and cannot
    drift.
    """
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT d.*,
                   COUNT(c.chunk_id)                              AS chunk_count,
                   COALESCE(SUM(c.embedded), 0)                   AS embedded_count,
                   MAX(c.created_at)                              AS last_chunked_at
              FROM documents d
              LEFT JOIN chunks c ON c.document_id = d.document_id
             GROUP BY d.document_id
             ORDER BY d.uploaded_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def set_extraction(
    document_id: str,
    *,
    status: str,
    error: str | None = None,
    extractor: str | None = None,
    page_count: int | None = None,
    char_count: int | None = None,
) -> None:
    with _connect() as conn:
        conn.execute(
            """
            UPDATE documents
               SET extract_status = ?, extract_error = ?, extractor = ?,
                   page_count = ?, char_count = ?, updated_at = ?
             WHERE document_id = ?
            """,
            (status, error, extractor, page_count, char_count, _now(), document_id),
        )


def update_document(document_id: str, **fields: Any) -> dict[str, Any] | None:
    """Edit the metadata retrieval filters on. Whitelisted, not reflected.

    A caller passing `content_hash` or `document_id` is either confused or
    malicious, and in both cases the right answer is an error rather than a
    silently ignored key — the same argument `registry.validate` makes about
    unknown tool arguments.
    """
    allowed = {"source_type", "title", "document_version", "reactor_mode"}
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"cannot update {', '.join(sorted(unknown))}; allowed: {', '.join(sorted(allowed))}")
    if not fields:
        return get_document(document_id)

    assignments = ", ".join(f"{key} = ?" for key in fields)
    with _connect() as conn:
        conn.execute(
            f"UPDATE documents SET {assignments}, updated_at = ? WHERE document_id = ?",
            (*fields.values(), _now(), document_id),
        )
    return get_document(document_id)


def delete_document(document_id: str) -> list[str]:
    """Remove a document and its chunks, returning the chunk ids that went.

    The ids come back because Chroma does not cascade: the caller has to delete
    the matching vectors, and it cannot know which ones after the rows are gone.
    Returning them is what makes "delete the document" and "delete its vectors"
    one operation rather than two that can disagree.
    """
    with _connect() as conn:
        ids = [
            r["chunk_id"]
            for r in conn.execute(
                "SELECT chunk_id FROM chunks WHERE document_id = ?", (document_id,)
            ).fetchall()
        ]
        conn.execute("DELETE FROM documents WHERE document_id = ?", (document_id,))
    return ids


# ── chunks ───────────────────────────────────────────────────────────────────


def replace_chunks(document_id: str, chunks: list[dict[str, Any]], *, run_id: str) -> list[str]:
    """Swap a document's chunks for a new set, in one transaction.

    Replace rather than append, because re-chunking a document with different
    settings produces a *different* set — appending would leave the old
    boundaries in the index alongside the new ones, and retrieval would return
    both. The returned ids are the ones removed, so the caller can drop their
    vectors.
    """
    now = _now()
    # One transaction: the delete and the insert are one edit. A crash between
    # them would leave a document whose chunks are gone from here but whose
    # vectors are still in Chroma, which is the state nothing can detect.
    with sqlite_util.transaction(paths.CORPUS_DB) as conn:
        stale = [
            r["chunk_id"]
            for r in conn.execute(
                "SELECT chunk_id FROM chunks WHERE document_id = ?", (document_id,)
            ).fetchall()
        ]
        conn.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
        conn.executemany(
            """
            INSERT INTO chunks (
                chunk_id, document_id, run_id, ordinal, text, char_start, char_end,
                token_estimate, page_number, section_title, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """,
            [
                (
                    c["chunk_id"], document_id, run_id, c["ordinal"], c["text"],
                    c["char_start"], c["char_end"], c.get("token_estimate"),
                    c.get("page_number"), c.get("section_title"), now,
                )
                for c in chunks
            ],
        )
    return stale


def mark_embedded(
    chunk_ids: list[str], *, model: str, collection: str, error: str | None = None
) -> None:
    """Record the outcome per chunk, not per document.

    A run that died at chunk 400 of 900 leaves both states in one document, and a
    document-level flag would have to pick one of them to be wrong about.
    """
    if not chunk_ids:
        return
    embedded = 0 if error else 1
    with sqlite_util.transaction(paths.CORPUS_DB) as conn:
        conn.executemany(
            """
            UPDATE chunks
               SET embedded = ?, embedding_model = ?, collection = ?, embed_error = ?
             WHERE chunk_id = ?
            """,
            [(embedded, model, collection, error, cid) for cid in chunk_ids],
        )


def clear_embed_state() -> int:
    """Mark every chunk unembedded, keeping its text. Returns how many.

    The counterpart to `mark_embedded`, and not expressible through it: that
    function records an *outcome*, and "no outcome yet" is a third state it
    cannot write. Used when the embedding model changes, where every vector
    becomes unusable and every chunk becomes work to redo.
    """
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE chunks SET embedded = 0, embedding_model = NULL, "
            "collection = NULL, embed_error = NULL"
        )
        return cursor.rowcount


def list_chunks(
    document_id: str | None = None, *, limit: int = 200, offset: int = 0
) -> dict[str, Any]:
    where, args = ("WHERE document_id = ?", [document_id]) if document_id else ("", [])
    with _connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS n FROM chunks {where}", args).fetchone()["n"]
        rows = conn.execute(
            f"""
            SELECT c.*, d.filename, d.source_type
              FROM chunks c JOIN documents d ON d.document_id = c.document_id
              {where.replace('document_id', 'c.document_id')}
             ORDER BY c.document_id, c.ordinal
             LIMIT ? OFFSET ?
            """,
            [*args, limit, offset],
        ).fetchall()
    return {"chunks": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


def chunks_by_id(chunk_ids: list[str]) -> list[dict[str, Any]]:
    """The stored chunks for a set of ids, with their document's filename.

    For retrieval replay, which holds ids from `rag_logs` and needs the text.
    Ids that no longer exist are simply absent from the result — a chunk
    retrieved before a re-ingest is a real and interesting state, and it is the
    caller that knows how to report it, not this function.
    """
    if not chunk_ids:
        return []
    marks = ",".join("?" * len(chunk_ids))
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT c.*, d.filename, d.source_type
              FROM chunks c JOIN documents d ON d.document_id = c.document_id
             WHERE c.chunk_id IN ({marks})
            """,
            chunk_ids,
        ).fetchall()
    return [dict(r) for r in rows]


def all_chunk_ids() -> list[str]:
    with _connect() as conn:
        return [r["chunk_id"] for r in conn.execute("SELECT chunk_id FROM chunks").fetchall()]


def pending_chunks(document_id: str | None = None) -> list[dict[str, Any]]:
    """Chunks with no vector — what a resume or a re-embed has to do."""
    where = "WHERE embedded = 0"
    args: list[Any] = []
    if document_id:
        where += " AND document_id = ?"
        args.append(document_id)
    with _connect() as conn:
        return [
            dict(r)
            for r in conn.execute(
                f"SELECT * FROM chunks {where} ORDER BY document_id, ordinal", args
            ).fetchall()
        ]


# ── runs and their log ───────────────────────────────────────────────────────


def start_run(
    *,
    run_id: str,
    kind: str,
    strategy: str,
    chunk_size: int,
    chunk_overlap: int,
    embedding_model: str | None,
    collection: str | None,
    documents_total: int,
) -> dict[str, Any]:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO ingest_runs (
                run_id, kind, status, stage, strategy, chunk_size, chunk_overlap,
                embedding_model, collection, documents_total, started_at
            ) VALUES (?,?,'running','queued',?,?,?,?,?,?,?)
            """,
            (
                run_id, kind, strategy, chunk_size, chunk_overlap,
                embedding_model, collection, documents_total, _now(),
            ),
        )
    return get_run(run_id) or {}


def update_run(run_id: str, **fields: Any) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    with _connect() as conn:
        conn.execute(
            f"UPDATE ingest_runs SET {assignments} WHERE run_id = ?",
            (*fields.values(), run_id),
        )


def finish_run(run_id: str, *, status: str, error: str | None = None) -> None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT started_at FROM ingest_runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        elapsed = None
        if row:
            try:
                began = datetime.fromisoformat(row["started_at"])
                elapsed = int((datetime.now(timezone.utc) - began).total_seconds() * 1000)
            except (ValueError, TypeError):
                elapsed = None
        conn.execute(
            """
            UPDATE ingest_runs
               SET status = ?, stage = ?, error = ?, finished_at = ?, elapsed_ms = ?
             WHERE run_id = ?
            """,
            (status, "complete" if status == "ok" else status, error, _now(), elapsed, run_id),
        )


def get_run(run_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        return _row(
            conn.execute("SELECT * FROM ingest_runs WHERE run_id = ?", (run_id,)).fetchone()
        )


def list_runs(limit: int = 30) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT r.*, (SELECT COUNT(*) FROM ingest_events e
                          WHERE e.run_id = r.run_id AND e.level = 'error') AS error_count
              FROM ingest_runs r
             ORDER BY r.started_at DESC
             LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def log(
    run_id: str,
    stage: str,
    message: str,
    *,
    level: str = "info",
    document_id: str | None = None,
    detail: Any = None,
) -> None:
    """One line in the pipeline's log. Never raises.

    A logging failure must not fail the ingest it is describing — that would make
    the log the least reliable part of the system it exists to explain. A write
    that cannot happen is dropped, and the run's own status still records the
    outcome.
    """
    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO ingest_events (run_id, at, level, stage, document_id, message, detail)
                VALUES (?,?,?,?,?,?,?)
                """,
                (
                    run_id, _now(), level, stage, document_id, message,
                    json.dumps(detail, default=str) if detail is not None else None,
                ),
            )
    except Exception:  # noqa: BLE001 — see the docstring
        pass


def events(run_id: str, *, level: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
    where, args = "WHERE run_id = ?", [run_id]
    if level:
        where += " AND level = ?"
        args.append(level)
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM ingest_events {where} ORDER BY id LIMIT ?", [*args, limit]
        ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        if item.get("detail"):
            try:
                item["detail"] = json.loads(item["detail"])
            except (ValueError, TypeError):
                pass
        out.append(item)
    return out


def stats() -> dict[str, Any]:
    """Corpus totals — for Settings → Databases and the pipeline header."""
    try:
        with _connect() as conn:
            docs = conn.execute(
                "SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM documents"
            ).fetchone()
            chunks = conn.execute(
                "SELECT COUNT(*) AS n, COALESCE(SUM(embedded),0) AS embedded FROM chunks"
            ).fetchone()
            failed = conn.execute(
                "SELECT COUNT(*) AS n FROM documents WHERE extract_status = 'failed'"
            ).fetchone()
            last = conn.execute(
                "SELECT run_id, status, finished_at FROM ingest_runs ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
        return {
            "available": True,
            "documents": docs["n"],
            "bytes": docs["bytes"],
            "chunks": chunks["n"],
            "embedded": chunks["embedded"],
            "failed_documents": failed["n"],
            "last_run": dict(last) if last else None,
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001 — a status call reports, never raises
        return {
            "available": False, "documents": 0, "bytes": 0, "chunks": 0,
            "embedded": 0, "failed_documents": 0, "last_run": None, "error": str(exc),
        }
