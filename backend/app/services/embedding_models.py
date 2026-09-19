"""The embedding model — which one turns chunks into vectors, and where it runs.

`architecture/04` Step 5: *"Generate embeddings locally. No cloud embedding
APIs."* This module is how that choice gets made, recorded and checked.

## The embedding model is not the chat model

They are separate models doing separate jobs, and conflating them is the easiest
mistake to make here:

| | Model | Runs |
|---|---|---|
| Embedding | `nomic-embed-text`, `all-minilm`, `bge-*` | Ingest time, offline |
| Chat | Qwen3, Phi-3, Gemma, Llama, Mistral (`PROJECT.md` §8.1) | Query time |

Swapping the chat model — including mid-conversation, which this project's
per-message picker allows — does nothing to the index. The vectors were produced
by a different model before any conversation started.

## Changing the embedding model is a one-way door

This is the constraint the whole module is shaped around. An embedding is only
comparable to other embeddings from the *same* model: different model, different
vector space, and cosine similarity over two spaces is not merely less accurate,
it is meaningless. Change the embedding model and every chunk must be
re-embedded.

So the choice is committed with the index it produced, and `status()` reports a
mismatch as `stale`. A silently mismatched index is the bad outcome: retrieval
keeps returning results, ranked by nonsense, with nothing on screen to say so.

## Cloud embedding models, and why they are quarantined

Rule 1 permits cloud models "strictly as offline evaluation baselines", and
`model_endpoints` already implements that for chat with a `purpose='benchmark'`
CHECK. Embeddings need the same discipline and then some, because the exposure
is categorically worse than a per-turn chat override:

- A cloud chat override sends **one turn**. Cloud embedding sends the **entire
  corpus** — every manual, every SOP — to a third party at ingest.
- It does not stop at ingest. Every query must be embedded by the same model to
  be comparable, so **every future question** also leaves the machine. There is
  no such thing as a one-off cloud embedding.

That is not a per-turn override, so it is never offered as one. A cloud
embedding model may be configured, but it is marked `production_safe: false`,
writes a **separate collection** so it cannot contaminate the local index, and
`resolve_for_runtime()` refuses to return it. It exists to answer "how much
accuracy does local cost us?" — a fair question, asked offline, over a corpus
you have decided may leave.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from datetime import datetime, timezone
from typing import Any

from ..db import paths
from . import ollama_client

CONFIG_PATH = paths.CONFIG_DIR / "embedding_config.json"

# The production collection, and the quarantine. Kept apart by name so a cloud
# run physically cannot overwrite the local index — the separation is a
# different collection, not a flag somebody has to remember to check.
LOCAL_COLLECTION = "daedalus_knowledge"
CLOUD_COLLECTION = "daedalus_knowledge_cloud_baseline"

# Ollama reports this in `/api/show` capabilities for models that embed.
EMBEDDING_CAPABILITY = "embedding"

# Recommended local models, from `architecture/04` Step 5 plus the two figures
# the ingestion pipeline actually needs from an embedding model: the vector
# width, and how much text fits in one pass.
#
# **These are declared values, and they are the fallback.** For anything pulled,
# `local_models()` reads the real numbers out of Ollama's `/api/show` —
# `<arch>.embedding_length` is the vector width and `<arch>.context_length` the
# window — and every row reports which source answered. This is the same rule
# `model_fit.py` follows for weight size, and for the same reason (`MODULES.md`
# §2.2): an estimate and a measurement must never look alike. A catalogue figure
# is a claim about a tag; a measured one is a fact about the file on this disk,
# and they do diverge — a re-quantized or repackaged tag can ship a different
# context window than the model card advertises.
#
# `max_tokens` matters more than it looks. M2 chunks at 300-500 tokens, so any
# of these has headroom — but a model with a 512-token window silently truncates
# a chunk that overran, and a truncated chunk embeds as a different document
# than the one the citation points at.
CATALOGUE: tuple[dict[str, Any], ...] = (
    {
        "tag": "nomic-embed-text",
        "label": "Nomic Embed Text",
        "dimensions": 768,
        "max_tokens": 8192,
        "approx_bytes": 274 * 1024 * 1024,
        "languages": "English",
        "recommended": True,
        "note": "architecture/04's recommendation. Long context for an embedder, so no chunk truncates.",
    },
    {
        "tag": "mxbai-embed-large",
        "label": "mxbai Embed Large",
        "dimensions": 1024,
        "max_tokens": 512,
        "approx_bytes": 670 * 1024 * 1024,
        "languages": "English",
        "recommended": False,
        "note": "Wider vectors than nomic at a fraction of the context. Fine for 300-500 token chunks, tight above that.",
    },
    {
        "tag": "bge-m3",
        "label": "BGE-M3",
        "dimensions": 1024,
        "max_tokens": 8192,
        "approx_bytes": 1200 * 1024 * 1024,
        "languages": "Multilingual (100+)",
        "recommended": False,
        "note": "Wide vectors and long context. Largest of the four — check it against the Forge's memory figures.",
    },
    {
        "tag": "all-minilm",
        "label": "all-MiniLM",
        "dimensions": 384,
        "max_tokens": 256,
        "approx_bytes": 46 * 1024 * 1024,
        "languages": "English",
        "recommended": False,
        "note": "architecture/04's 'if hardware is weak'. Tiny and fast; 256 tokens truncates a 500-token chunk.",
    },
)

_BY_TAG = {entry["tag"]: entry for entry in CATALOGUE}

# Chroma stores float32, so a vector costs 4 bytes per dimension. Spelled out
# rather than folded into a total, because the point of showing it is that a
# reader can check it: 768 dims x 4 = 3.0KB a chunk, and a 200-chunk corpus is
# under a megabyte. The figure matters less for disk than for what it implies —
# doubling the dimensions doubles the index and the per-query comparison cost.
BYTES_PER_DIMENSION = 4

# What `TODO.md` M2 targets, used only to turn "3KB a chunk" into a number with
# a unit somebody can picture. Labelled as an illustration wherever it is shown.
ILLUSTRATIVE_CHUNKS = 200


def _derived(dimensions: int | None) -> dict[str, Any]:
    """Index-size arithmetic for one vector width."""
    if not dimensions:
        return {"bytes_per_vector": None, "index_bytes_estimate": None}
    per_vector = dimensions * BYTES_PER_DIMENSION
    return {
        "bytes_per_vector": per_vector,
        "index_bytes_estimate": per_vector * ILLUSTRATIVE_CHUNKS,
        "illustrative_chunks": ILLUSTRATIVE_CHUNKS,
    }

# One short, neutral string. Content is irrelevant — only the length of the
# returned vector is read — but it is fixed so a re-verification is comparable
# to the last one rather than depending on what was typed.
PROBE_TEXT = "reactor temperature threshold"

DEFAULT: dict[str, Any] = {
    "provider": "local",
    "model": "nomic-embed-text",
    "endpoint_id": None,
    "dimensions": 768,
    # Which model actually produced the vectors currently in the store. None
    # until ingestion runs. A difference from `model` means re-ingest.
    "indexed_with": None,
    "indexed_at": None,
    "collection": LOCAL_COLLECTION,
    # Per-tag results of actually embedding `PROBE_TEXT`, keyed by tag. Kept in
    # the same file because it is small, is about embedding models, and reviews
    # in a diff — and because a verified width is a fact worth surviving a
    # restart rather than being re-derived by loading a model again.
    "verified": {},
}

_lock = threading.Lock()


class NotProductionSafe(Exception):
    """A cloud embedding model was asked for on a path that must stay local."""


def _normalise_tag(tag: str) -> str:
    """`nomic-embed-text:latest` and `nomic-embed-text` are the same model."""
    return tag.split(":", 1)[0] if tag.endswith(":latest") else tag


def read() -> dict[str, Any]:
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT)
    return {**DEFAULT, **{k: v for k, v in raw.items() if k in DEFAULT}}


def write(
    *,
    provider: str,
    model: str,
    endpoint_id: str | None = None,
    dimensions: int | None = None,
) -> dict[str, Any]:
    """Commit a choice. Does **not** clear `indexed_with` — that is the point.

    Selecting a different model leaves the record of what built the current
    index intact, so `status()` can report the mismatch. Clearing it here would
    erase the only evidence that the index needs rebuilding.
    """
    if provider not in ("local", "cloud"):
        raise ValueError(f"unknown provider {provider!r}")
    if provider == "cloud" and not endpoint_id:
        raise ValueError("a cloud embedding model needs an endpoint_id")

    with _lock:
        current = read()
        payload = {
            **current,
            "provider": provider,
            "model": model,
            "endpoint_id": endpoint_id if provider == "cloud" else None,
            "dimensions": dimensions or _BY_TAG.get(_normalise_tag(model), {}).get("dimensions"),
            "collection": CLOUD_COLLECTION if provider == "cloud" else LOCAL_COLLECTION,
        }
        paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=paths.CONFIG_DIR, prefix=".embedding_config-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, CONFIG_PATH)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return payload


def record_index(model: str, dimensions: int | None, at: str) -> dict[str, Any]:
    """Called by ingestion when it finishes. This is what makes `stale` work."""
    with _lock:
        current = read()
        payload = {**current, "indexed_with": model, "indexed_at": at, "dimensions": dimensions}
        paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return payload


def verify(tag: str) -> dict[str, Any]:
    """Embed a probe string and record the width the model actually returns.

    `/api/show` reports what the architecture declares; this reports what a
    vector store would receive. The Forge already treats a benchmark as
    outranking an estimate, and this is the same relationship one tier further
    up: `declared` < `measured` < `verified`.

    Unlike every other figure here, this one loads the model — briefly, for a
    single forward pass over a few words. That is the whole cost, and it buys the
    only number that is ground truth for what lands in the index.
    """
    installed_tag = tag
    for row in local_models():
        if row["tag"] == _normalise_tag(tag) and row.get("installed_tag"):
            installed_tag = row["installed_tag"]
            break

    started = time.perf_counter()
    vector = ollama_client.embed(installed_tag, PROBE_TEXT)
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    normalised = _normalise_tag(tag)
    record = {
        "dimensions": len(vector),
        "verified_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "probe": PROBE_TEXT,
        "elapsed_ms": elapsed_ms,
    }

    with _lock:
        config = read()
        verified = dict(config.get("verified") or {})
        verified[normalised] = record
        payload = {**config, "verified": verified}
        paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    return record


def local_models() -> list[dict[str, Any]]:
    """Embedding-capable models, installed and recommended, in one list.

    Capability comes from Ollama's own `/api/show` rather than from matching
    names against the catalogue: a name match would miss anything a user pulled
    that is not in the four below, and this is meant to show what the machine
    actually has.
    """
    installed: dict[str, dict[str, Any]] = {}
    if ollama_client.available():
        for model in ollama_client.list_models():
            name = model.get("name") or model.get("model") or ""
            if not name:
                continue
            try:
                detail = ollama_client.show(name)
            except Exception:  # noqa: BLE001 — one bad model must not empty the list
                continue
            if EMBEDDING_CAPABILITY not in (detail.get("capabilities") or []):
                continue
            tag = _normalise_tag(name)
            known = _BY_TAG.get(tag, {})

            # Measured first, declared as the fallback. A model pulled from
            # outside the catalogue has no declared figures at all, so this is
            # also the only way it gets any.
            arch = detail.get("arch") or {}
            measured_dims = arch.get("embedding_length")
            measured_ctx = detail.get("context_length") or arch.get("context_length")

            dimensions = measured_dims or known.get("dimensions")
            max_tokens = measured_ctx or known.get("max_tokens")

            installed[tag] = {
                "tag": tag,
                "installed_tag": name,
                "label": known.get("label", tag),
                "installed": True,
                "size_bytes": model.get("size"),
                "dimensions": dimensions,
                "dimensions_source": "measured" if measured_dims else (
                    "declared" if known.get("dimensions") else "unknown"
                ),
                "max_tokens": max_tokens,
                "max_tokens_source": "measured" if measured_ctx else (
                    "declared" if known.get("max_tokens") else "unknown"
                ),
                "languages": known.get("languages"),
                "family": detail.get("family"),
                "parameter_size": detail.get("parameter_size"),
                "quantization": detail.get("quantization_level"),
                "recommended": known.get("recommended", False),
                "note": known.get("note", "Pulled locally; not in the recommended set."),
                **_derived(dimensions),
            }

    # A verified width outranks the header's declared one — it is what a vector
    # store would actually receive. The header value is kept alongside so a
    # disagreement is visible rather than quietly overwritten.
    verified = read().get("verified") or {}
    for tag, row in installed.items():
        record = verified.get(tag)
        if not record:
            continue
        header_dims = row["dimensions"]
        row["dimensions"] = record["dimensions"]
        row["dimensions_source"] = "verified"
        row["verified_at"] = record.get("verified_at")
        row["header_dimensions"] = header_dims
        row["dimensions_mismatch"] = bool(
            header_dims and header_dims != record["dimensions"]
        )
        row.update(_derived(record["dimensions"]))

    rows = list(installed.values())
    for entry in CATALOGUE:
        if entry["tag"] in installed:
            continue
        rows.append({
            "tag": entry["tag"],
            "installed_tag": None,
            "label": entry["label"],
            "installed": False,
            # Nothing is on disk to measure, so every figure here is a claim
            # about the published tag. Marked as such rather than shown bare.
            "size_bytes": entry["approx_bytes"],
            "dimensions": entry["dimensions"],
            "dimensions_source": "declared",
            "max_tokens": entry["max_tokens"],
            "max_tokens_source": "declared",
            "languages": entry["languages"],
            "family": None,
            "parameter_size": None,
            "quantization": None,
            "recommended": entry["recommended"],
            "note": entry["note"],
            **_derived(entry["dimensions"]),
        })

    # Installed first, then the recommendation, then the rest — the order you
    # would work down when deciding what to pull.
    rows.sort(key=lambda r: (not r["installed"], not r["recommended"], r["tag"]))
    return rows


def cloud_baselines() -> list[dict[str, Any]]:
    """Configured cloud endpoints usable as an embedding baseline.

    Reuses the chat baselines' credentials rather than adding a second store:
    they are the same accounts, and `purpose='benchmark'` already constrains
    them to offline evaluation.
    """
    from . import model_endpoints  # noqa: PLC0415 — avoids an import cycle at boot

    try:
        rows = model_endpoints.list_endpoints()
    except Exception:  # noqa: BLE001
        return []
    return [
        {
            "id": row["id"],
            "label": row["label"],
            "provider": row["provider"],
            "enabled": row["enabled"],
            "has_key": row["has_key"],
        }
        for row in rows
        if row.get("purpose") == "benchmark"
    ]


def status() -> dict[str, Any]:
    """The choice, what it can reach, and whether the index matches it."""
    config = read()
    models = local_models()
    chosen_tag = _normalise_tag(config["model"])
    chosen = next((m for m in models if m["tag"] == chosen_tag), None)

    ready = bool(chosen and chosen["installed"]) if config["provider"] == "local" else bool(
        config.get("endpoint_id")
    )

    indexed_with = config.get("indexed_with")
    if indexed_with is None:
        index_state, index_detail = "empty", "nothing has been ingested yet"
    elif _normalise_tag(indexed_with) == chosen_tag:
        index_state, index_detail = "current", f"built with {indexed_with}"
    else:
        index_state = "stale"
        index_detail = (
            f"built with {indexed_with}, but {config['model']} is selected — "
            "every chunk must be re-embedded before retrieval means anything"
        )

    return {
        **config,
        "production_safe": config["provider"] == "local",
        "ready": ready,
        "index_state": index_state,
        "index_detail": index_detail,
        "local_models": models,
        "cloud_baselines": cloud_baselines(),
        "ollama_available": ollama_client.available(),
    }


def resolve_for_runtime() -> dict[str, Any]:
    """The model the ingestion pipeline and query path must use.

    Refuses a cloud model. Rule 1 has an override for a chat turn and none for
    this: embedding the corpus in the cloud sends every document out, and
    embedding each query to match sends every question out after it.
    """
    config = read()
    if config["provider"] != "local":
        raise NotProductionSafe(
            "the selected embedding model is a cloud baseline and cannot serve the local "
            "system. Rule 1 permits cloud models as offline evaluation baselines only — "
            "select a local model in Settings → Knowledge Base."
        )
    return config
