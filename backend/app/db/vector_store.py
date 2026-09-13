"""RAG vector store (Layer 5) — ChromaDB.

Two deployment shapes, same interface:

* **Server mode** — `CHROMA_URL` points at the `chromadb` compose service.
* **Embedded mode** — no URL, so a persistent client writes to `data/chroma/`.

Chroma is an optional import: the dashboard and preference API must still boot
on a machine where the RAG stack has not been installed yet, so a missing
package degrades to a reported status rather than an import error at startup.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from .paths import CHROMA_DIR, CHROMA_URL, ensure_dirs

COLLECTION = "daedalus_knowledge"

_client: Any = None
_last_error: str | None = None


def _make_client() -> Any:
    global _last_error
    try:
        import chromadb  # noqa: PLC0415 — optional dependency, imported on demand
    except ImportError as exc:
        _last_error = f"chromadb is not installed ({exc})"
        return None

    try:
        if CHROMA_URL:
            parsed = urlparse(CHROMA_URL)
            return chromadb.HttpClient(
                host=parsed.hostname or "localhost",
                port=parsed.port or 8001,
            )
        ensure_dirs()
        return chromadb.PersistentClient(path=str(CHROMA_DIR))
    except Exception as exc:  # noqa: BLE001 — surfaced as status, never fatal
        _last_error = str(exc)
        return None


def get_client() -> Any:
    """Cached client, or None when Chroma is unavailable."""
    global _client
    if _client is None:
        _client = _make_client()
    return _client


def get_collection() -> Any:
    client = get_client()
    if client is None:
        return None
    try:
        return client.get_or_create_collection(name=COLLECTION)
    except Exception as exc:  # noqa: BLE001
        global _last_error
        _last_error = str(exc)
        return None


def stats() -> dict[str, Any]:
    """Reachability and document count — for Settings → Databases."""
    mode = "server" if CHROMA_URL else "embedded"
    target = CHROMA_URL or str(CHROMA_DIR)

    collection = get_collection()
    if collection is None:
        return {
            "available": False,
            "mode": mode,
            "target": target,
            "collection": COLLECTION,
            "documents": 0,
            "error": _last_error or "not initialised",
        }
    try:
        return {
            "available": True,
            "mode": mode,
            "target": target,
            "collection": COLLECTION,
            "documents": collection.count(),
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "available": False,
            "mode": mode,
            "target": target,
            "collection": COLLECTION,
            "documents": 0,
            "error": str(exc),
        }
