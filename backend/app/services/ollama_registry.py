"""Ollama's public registry — tag verification and real sizes before pulling.

Two problems this solves, both of which the Forge had as open caveats.

**Tags nobody had checked.** The catalogue declares tags like
`qwen3:1.7b-q8_0`, and Ollama publishes no listable tags API, so they shipped
marked `tag_verified: false` with a note to check them by hand. But the OCI
manifest endpoint answers per tag — 200 for a real one, 404 for a typo — which
verifies them exactly and automatically.

**Sizes that were arithmetic.** `params × bytes_per_param` is an estimate with
real error in it: a 128k-token vocabulary at higher precision pushes a small
model well above its nominal width. The manifest lists the model layer's size in
bytes, so the *actual* download size is knowable before anything is downloaded.
`services/model_fit.py` prefers it, and the estimate stops guessing at the one
term that dominates it.

That gives three provenances rather than two, in increasing order of authority:

    declared  → params × bytes_per_param, from the catalogue
    registry  → the real weight size, from the manifest, before pulling
    measured  → the real size on disk plus the real architecture, after pulling

## Network, and the absence of it

This is the only part of the Forge that talks to a non-local host, and it is a
read of a public registry — no credentials, no telemetry, nothing uploaded. It
is also entirely optional: every call fails soft to "unknown", and an offline
machine sees the declared estimate it would have seen anyway.
"""

from __future__ import annotations

import threading
import time
from typing import Any

try:
    import httpx
except Exception:  # pragma: no cover - defensive
    httpx = None  # type: ignore[assignment]

REGISTRY = "https://registry.ollama.ai/v2"
TIMEOUT = 8.0

# A manifest for a given tag is immutable in practice — a republished tag gets a
# new digest — so this is cached for the life of the process. The TTL only
# matters for a 404 that later becomes a 200, which is a model being published.
_TTL = 6 * 3600.0
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()

_MODEL_LAYER = "application/vnd.ollama.image.model"
_ACCEPT = "application/vnd.docker.distribution.manifest.v2+json"


def _split(tag: str) -> tuple[str, str] | None:
    """`qwen3:1.7b` → `library/qwen3`, `1.7b`; `hf.co/...` → None.

    Hugging Face pulls go through a different path entirely and are described by
    the HF API, so they are not this module's business.
    """
    if not tag or tag.startswith("hf.co/") or tag.startswith("huggingface.co/"):
        return None
    name, _, version = tag.partition(":")
    version = version or "latest"
    # A bare name is in the official library; `user/name` is a namespaced repo.
    repo = name if "/" in name else f"library/{name}"
    return repo, version


def manifest(tag: str) -> dict[str, Any]:
    """Whether a tag exists, and how large its weights are.

    Always returns a dict. `exists` is None — not False — when the registry
    could not be reached, because "this tag is wrong" and "you are offline" must
    not look the same to the UI.
    """
    parts = _split(tag)
    if parts is None:
        return {"exists": None, "weights_bytes": None, "error": "not an Ollama registry tag"}
    if httpx is None:
        return {"exists": None, "weights_bytes": None, "error": "httpx is not installed"}

    now = time.monotonic()
    with _lock:
        hit = _cache.get(tag)
    if hit and now - hit[0] < _TTL:
        return hit[1]

    repo, version = parts
    try:
        response = httpx.get(
            f"{REGISTRY}/{repo}/manifests/{version}",
            headers={"Accept": _ACCEPT},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
    except Exception as exc:  # noqa: BLE001
        # Not cached: an offline machine that comes back online should pick the
        # answer up rather than stay wrong for six hours.
        return {
            "exists": None,
            "weights_bytes": None,
            "error": f"could not reach the Ollama registry ({exc.__class__.__name__})",
        }

    if response.status_code == 404:
        result = {"exists": False, "weights_bytes": None, "error": None}
    elif response.status_code >= 400:
        return {
            "exists": None,
            "weights_bytes": None,
            "error": f"registry returned HTTP {response.status_code}",
        }
    else:
        weights = None
        try:
            for layer in response.json().get("layers") or []:
                if layer.get("mediaType") == _MODEL_LAYER:
                    weights = int(layer.get("size") or 0) or None
                    break
        except Exception:  # noqa: BLE001
            weights = None
        result = {"exists": True, "weights_bytes": weights, "error": None}

    with _lock:
        _cache[tag] = (now, result)
    return result


def verify_many(tags: list[str]) -> dict[str, dict[str, Any]]:
    """Manifests for a list of tags, in parallel.

    Serially this is one round trip per tag and the model table has dozens —
    several seconds of latency for something every row needs. Threads rather
    than async because the callers here are sync FastAPI endpoints running in
    the threadpool already, and the work is entirely network wait.
    """
    unique = list(dict.fromkeys(t for t in tags if t))
    results: dict[str, dict[str, Any]] = {}

    # Cached entries cost nothing; only go wide for the rest.
    pending = []
    now = time.monotonic()
    for tag in unique:
        with _lock:
            hit = _cache.get(tag)
        if hit and now - hit[0] < _TTL:
            results[tag] = hit[1]
        else:
            pending.append(tag)

    if not pending:
        return results

    from concurrent.futures import ThreadPoolExecutor

    # Capped: this is somebody else's public registry, and a burst of sixty
    # simultaneous requests is rude regardless of whether it would be served.
    with ThreadPoolExecutor(max_workers=min(8, len(pending))) as pool:
        for tag, result in zip(pending, pool.map(manifest, pending)):
            results[tag] = result
    return results


def clear_cache() -> None:
    with _lock:
        _cache.clear()
