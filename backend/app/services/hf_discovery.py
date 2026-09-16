"""Hugging Face GGUF discovery — the catalogue beyond the catalogue.

`docs/research/05` scopes the declared catalogue to six shortlisted candidates,
and that shortlist is what the report argues about. But the console should be
able to answer a broader question too — *what else could this machine run?* —
without somebody hand-editing JSON for every model they want to consider.

So this searches Hugging Face for GGUF repositories and scores them on exactly
the same footing as a declared candidate. Three things make that possible:

1. `?filter=gguf` returns only repositories with GGUF weights, which is the
   format Ollama can actually load.
2. `?expand[]=gguf` returns the parameter count, architecture and trained
   context length **in the search response** — one request for a whole page,
   rather than a detail call per result. That is the difference between a usable
   search box and one that takes twenty seconds.
3. Ollama pulls straight from Hugging Face: `ollama pull hf.co/{repo}:{quant}`.
   So a discovered model is not a dead end — the Pull button works on it.

Quantization variants come from the repository's file list, parsed out of the
`.gguf` filenames, because that is the only place they are recorded.

## Never raises, and never blocks for long

No network, a rate limit, a schema change — all return an empty list with a
reason. This is a search box; a machine with no internet is a supported
configuration and the rest of the Forge must keep working on it.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Any
from urllib.parse import urlencode

try:
    import httpx
except Exception:  # pragma: no cover - defensive
    httpx = None  # type: ignore[assignment]

HF_API = "https://huggingface.co/api/models"

SEARCH_TIMEOUT = 12.0

# Results are cached for an hour. The catalogue of what exists on Hugging Face
# does not change minute to minute, and a filter toolbar re-queries on every
# keystroke-debounce, tab switch and rescore.
_CACHE_TTL = 3600.0
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_cache_lock = threading.Lock()

# Quantization as it appears in a GGUF filename: `...-Q4_K_M.gguf`,
# `...-IQ4_XS.gguf`, `...-BF16-00001-of-00002.gguf`. Anchored on the separator
# so `Qwen3-Coder` does not match as a quantization.
_QUANT_IN_FILENAME = re.compile(
    r"[.\-_](IQ\d[_A-Z]*|Q\d[_A-Z0-9]*|BF16|F16|FP16|F32|MXFP4)(?:[.\-_]|$)",
    re.IGNORECASE,
)

# Repositories that are shards, imatrix side-files or otherwise not a model a
# person would pull.
_SKIP_FILE_HINTS = ("imatrix", "mmproj")


def _parse_quants(siblings: list[dict[str, Any]] | None) -> list[str]:
    """Quantization variants a repository actually ships, from its .gguf files."""
    if not siblings:
        return []
    found: dict[str, None] = {}
    for entry in siblings:
        name = str(entry.get("rfilename") or "")
        if not name.lower().endswith(".gguf"):
            continue
        if any(hint in name.lower() for hint in _SKIP_FILE_HINTS):
            continue
        match = _QUANT_IN_FILENAME.search(name.rsplit("/", 1)[-1])
        if match:
            # Upper-cased so `q4_k_m` and `Q4_K_M` are one entry. Ollama's tag
            # for a Hugging Face pull is case-insensitive.
            found.setdefault(match.group(1).upper(), None)
    return list(found)


def _row(raw: dict[str, Any]) -> dict[str, Any] | None:
    gguf = raw.get("gguf") or {}
    total = gguf.get("total")
    repo = raw.get("id") or raw.get("modelId")
    if not repo or not isinstance(total, (int, float)) or total <= 0:
        # No parameter count means no memory estimate, and a row that cannot be
        # scored is worse than absent in a list whose entire job is ranking.
        return None

    quants = _parse_quants(raw.get("siblings"))
    return {
        "repo": repo,
        "author": raw.get("author") or repo.split("/")[0],
        "params_b": round(float(total) / 1e9, 2),
        "architecture": gguf.get("architecture"),
        "context_length": gguf.get("context_length"),
        "downloads": raw.get("downloads"),
        "likes": raw.get("likes"),
        "gated": bool(raw.get("gated")),
        "quantizations": quants,
        "url": f"https://huggingface.co/{repo}",
    }


def search(query: str = "", *, limit: int = 24) -> dict[str, Any]:
    """GGUF repositories on Hugging Face, scorable and pullable.

    Sorted by downloads rather than relevance when no query is given, so an
    empty search box shows what people actually run rather than an arbitrary
    slice of a very large index.
    """
    if httpx is None:
        return {"models": [], "error": "httpx is not installed", "cached": False}

    key = f"{query.strip().lower()}|{limit}"
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL:
        return {"models": hit[1], "error": None, "cached": True}

    params = [
        ("filter", "gguf"),
        ("sort", "downloads"),
        ("direction", "-1"),
        # Over-fetch: rows without a parameter count are dropped below, and
        # asking for exactly `limit` would return short pages.
        ("limit", str(min(limit * 2, 100))),
        ("expand[]", "gguf"),
        ("expand[]", "downloads"),
        ("expand[]", "likes"),
        ("expand[]", "siblings"),
        ("expand[]", "gated"),
        ("expand[]", "author"),
    ]
    if query.strip():
        params.append(("search", query.strip()))

    try:
        response = httpx.get(f"{HF_API}?{urlencode(params)}", timeout=SEARCH_TIMEOUT)
        if response.status_code >= 400:
            return {
                "models": [],
                "error": f"Hugging Face returned HTTP {response.status_code}",
                "cached": False,
            }
        payload = response.json()
    except Exception as exc:  # noqa: BLE001
        return {
            "models": [],
            # Named plainly: offline is a normal state for this project and the
            # UI should say so rather than implying the search is broken.
            "error": f"could not reach Hugging Face ({exc.__class__.__name__})",
            "cached": False,
        }

    rows: list[dict[str, Any]] = []
    for raw in payload if isinstance(payload, list) else []:
        row = _row(raw)
        if row:
            rows.append(row)
        if len(rows) >= limit:
            break

    with _cache_lock:
        _cache[key] = (now, rows)
    return {"models": rows, "error": None, "cached": False}


def ollama_tag(repo: str, quant: str | None) -> str:
    """The tag Ollama pulls a Hugging Face repository with.

    `ollama pull hf.co/{repo}:{quant}` is a first-class path in Ollama, which is
    what makes discovery here actionable rather than informational.
    """
    return f"hf.co/{repo}:{quant}" if quant else f"hf.co/{repo}"


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def detail(repo: str) -> dict[str, Any]:
    """One repository, for a tag somebody typed rather than picked from a search.

    Same shape as a `search()` row. Separate call because the search index is
    paged and a specific repository may not be on the page the search returned —
    asking for it by name always works.
    """
    if httpx is None:
        return {"model": None, "error": "httpx is not installed"}

    key = f"detail:{repo.lower()}"
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL:
        return {"model": hit[1][0] if hit[1] else None, "error": None}

    try:
        response = httpx.get(
            f"{HF_API}/{repo}",
            params={"expand[]": ["gguf", "downloads", "likes", "siblings", "gated", "author"]},
            timeout=SEARCH_TIMEOUT,
        )
        if response.status_code == 404:
            return {"model": None, "error": f"no such Hugging Face repository: {repo}"}
        if response.status_code >= 400:
            return {"model": None, "error": f"Hugging Face returned HTTP {response.status_code}"}
        row = _row(response.json())
    except Exception as exc:  # noqa: BLE001
        return {"model": None, "error": f"could not reach Hugging Face ({exc.__class__.__name__})"}

    if not row:
        return {
            "model": None,
            # A repository with no GGUF metadata is usually a safetensors-only
            # one, which Ollama cannot pull — worth saying, rather than a bare
            # "not found" for something that plainly exists.
            "error": f"{repo} publishes no GGUF weights, so Ollama cannot pull it",
        }

    with _cache_lock:
        _cache[key] = (now, [row])
    return {"model": row, "error": None}


def parse_hf_tag(tag: str) -> tuple[str, str | None] | None:
    """`hf.co/user/repo:Q4_K_M` → (`user/repo`, `Q4_K_M`). None if not an HF tag."""
    for prefix in ("hf.co/", "huggingface.co/"):
        if tag.startswith(prefix):
            rest = tag[len(prefix):]
            repo, _, quant = rest.partition(":")
            return repo, (quant or None)
    return None
