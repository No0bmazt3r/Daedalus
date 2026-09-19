"""RAG vector store (Layer 5) — ChromaDB.

Two deployment shapes, same interface:

* **Server mode** — `CHROMA_URL` points at the `chromadb` compose service.
* **Embedded mode** — no URL, so a persistent client writes to `data/chroma/`.

Chroma is an optional import: the dashboard and preference API must still boot
on a machine where the RAG stack has not been installed yet, so a missing
package degrades to a reported status rather than an import error at startup.

## One collection per embedding model

A vector is only comparable to vectors from the same embedding model, so the
model that built a collection is part of its name: `daedalus_knowledge__<tag>`.
Changing the embedding model therefore cannot land in the index the previous one
built — it addresses a different collection, empty until something ingests into
it, and changing back costs nothing and loses nothing. Cloud baselines carry
their own prefix on top of that, so a cloud run is quarantined by name as well
as by policy.

This replaces a single fixed collection that every model shared, where the only
thing standing between a model change and a corrupted index was remembering to
re-ingest.

## The stamp, and why the name is not enough

The name says which model *should* have written a collection. The collection's
own metadata says which one *did*, and they are not the same claim: restore a
config from git, copy a `data/chroma/` between machines, or rename a tag, and
only the stamp still tells the truth. So ingestion writes both (`stamp_index`),
and the stamp is what `get_collection` checks.

A collection holding vectors that no stamp accounts for is refused rather than
queried. The alternative is retrieval that compares vectors from two different
spaces, which does not return worse results — it returns confidently ranked
nonsense, with nothing on screen to say so. `MODULES.md` §2.2 is the same
argument one layer up: this project's claim is groundedness, so this failure has
to be loud.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from .paths import CHROMA_DIR, CHROMA_URL, ensure_dirs

# The prefix every collection this project owns begins with — and, on its own,
# the name used when no embedding model has been chosen yet or the config cannot
# be read. Nothing ingests into the bare name; it exists so a status call can
# still answer before there is a model to name a collection after.
COLLECTION = "daedalus_knowledge"

# What ingestion records on the collection. Chroma metadata holds primitives
# only, so these are three flat keys rather than one nested object.
STAMP_MODEL = "embedding_model"
STAMP_DIMENSIONS = "embedding_dimensions"
STAMP_AT = "indexed_at"

_client: Any = None
_last_error: str | None = None


class IndexMismatch(RuntimeError):
    """This collection's vectors were not produced by the selected model.

    Raised instead of returning the collection, because every use of it from
    here is a similarity comparison and the comparison is the thing that is
    invalid. Callers that want the raw contents anyway — the database browser —
    ask for them with `require_match=False`.
    """


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


# The naming policy belongs to the embedding domain — it is derived from the
# selected model — so it lives in `services/embedding_models` and is imported
# here lazily. The alternative is every caller resolving a name before it can
# open a collection, which is how a caller ends up hardcoding one.
def _embedding_models() -> Any:
    from ..services import embedding_models  # noqa: PLC0415 — see comment above

    return embedding_models


def resolve_collection() -> str:
    """The collection the currently selected embedding model owns."""
    try:
        return _embedding_models().collection_for()
    except Exception:  # noqa: BLE001 — a store must answer before a model is chosen
        return COLLECTION


def _selected_model() -> str | None:
    """The embedding model a query would use, normalised. None when unknowable."""
    try:
        models = _embedding_models()
        return models.normalise_tag(models.read()["model"])
    except Exception:  # noqa: BLE001
        return None


def _open(name: str, *, create: bool) -> Any:
    client = get_client()
    if client is None:
        return None
    global _last_error
    try:
        if create:
            return client.get_or_create_collection(name=name)
        return client.get_collection(name=name)
    except Exception as exc:  # noqa: BLE001 — a missing collection is a normal state
        _last_error = str(exc)
        return None


def mismatch(collection: Any) -> str | None:
    """Why this collection must not be queried, or None when it is safe to.

    Empty is safe: there are no vectors, so there is nothing to compare wrongly.
    Documents with no stamp are not safe — they were written by something that
    did not record itself, and an unknown vector space cannot be declared
    compatible with the selected one just because the name looks right.
    """
    selected = _selected_model()
    if selected is None:
        return None

    try:
        stamped = (collection.metadata or {}).get(STAMP_MODEL)
    except Exception:  # noqa: BLE001
        stamped = None

    if stamped:
        if stamped == selected:
            return None
        return (
            f"{collection.name} was built with {stamped}, but {selected} is selected. "
            "Vectors from two embedding models are not comparable — re-ingest before querying."
        )

    try:
        documents = collection.count()
    except Exception:  # noqa: BLE001
        return None
    if documents:
        return (
            f"{collection.name} holds {documents} vectors with no record of which embedding "
            f"model produced them, so they cannot be treated as comparable with {selected}. "
            "Re-ingest."
        )
    return None


def get_collection(
    name: str | None = None,
    *,
    require_match: bool = True,
    create: bool = True,
) -> Any:
    """The collection to work with, checked against the selected model.

    `require_match` defaults to True so that retrieval written later inherits the
    guard rather than having to remember it: forgetting it is exactly the bug the
    guard exists to prevent. The database browser passes False, because showing
    what is actually stored — including an index nothing should query — is its
    whole job.

    Raises `IndexMismatch` rather than returning None, because "no collection"
    and "a collection you must not trust" need different handling and a caller
    that treats them alike has a bug.
    """
    collection = _open(name or resolve_collection(), create=create)
    if collection is None or not require_match:
        return collection
    problem = mismatch(collection)
    if problem:
        raise IndexMismatch(problem)
    return collection


def stamp_index(name: str, *, model: str, dimensions: int | None, at: str) -> None:
    """Record on the collection which model produced its vectors.

    Called by ingestion, and allowed to fail loudly: an index nobody can
    attribute is the state this whole module is arranged to prevent, so it is
    better not to finish an ingest than to finish one that cannot be checked.
    """
    collection = _open(name, create=True)
    if collection is None:
        raise RuntimeError(f"cannot stamp {name}: {_last_error or 'chroma unavailable'}")
    metadata = {**(collection.metadata or {}), STAMP_MODEL: model, STAMP_AT: at}
    if dimensions:
        metadata[STAMP_DIMENSIONS] = int(dimensions)
    collection.modify(metadata=metadata)


def describe(name: str | None = None) -> dict[str, Any]:
    """Existence, size and stamp for one collection. Never raises.

    Deliberately does not create: opening a status page should not bring an empty
    collection into being, or every screen that reports on the index would also
    be quietly making one.
    """
    name = name or resolve_collection()
    client = get_client()
    if client is None:
        return {
            "name": name,
            "available": False,
            "exists": False,
            "documents": 0,
            "embedding_model": None,
            "dimensions": None,
            "indexed_at": None,
            "error": _last_error or "not initialised",
        }

    collection = _open(name, create=False)
    if collection is None:
        # Reachable and empty-handed: the collection has never been created,
        # which is the normal state before the first ingest.
        return {
            "name": name,
            "available": True,
            "exists": False,
            "documents": 0,
            "embedding_model": None,
            "dimensions": None,
            "indexed_at": None,
            "error": None,
        }

    try:
        metadata = collection.metadata or {}
        return {
            "name": name,
            "available": True,
            "exists": True,
            "documents": collection.count(),
            "embedding_model": metadata.get(STAMP_MODEL),
            "dimensions": metadata.get(STAMP_DIMENSIONS),
            "indexed_at": metadata.get(STAMP_AT),
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "name": name,
            "available": False,
            "exists": True,
            "documents": 0,
            "embedding_model": None,
            "dimensions": None,
            "indexed_at": None,
            "error": str(exc),
        }


def collections() -> list[dict[str, Any]]:
    """Every index this project owns, described.

    One collection per embedding model means there can legitimately be several —
    a local index and a cloud baseline built from the same corpus are the point
    of the comparison, not a mess to clean up. Anything not carrying this
    project's prefix belongs to something else sharing the Chroma instance and
    is left alone.
    """
    client = get_client()
    if client is None:
        return []
    try:
        names = sorted(
            c.name for c in client.list_collections() if c.name.startswith(COLLECTION)
        )
    except Exception:  # noqa: BLE001
        return []
    return [describe(name) for name in names]


def stats(name: str | None = None) -> dict[str, Any]:
    """Reachability, size and provenance — for Settings → Databases."""
    mode = "server" if CHROMA_URL else "embedded"
    target = CHROMA_URL or str(CHROMA_DIR)
    info = describe(name)

    return {
        "available": info["available"],
        "mode": mode,
        "target": target,
        "collection": info["name"],
        "exists": info["exists"],
        "documents": info["documents"],
        "embedding_model": info["embedding_model"],
        "dimensions": info["dimensions"],
        "indexed_at": info["indexed_at"],
        "error": info["error"],
    }
