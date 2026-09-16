"""Ollama, as the Forge uses it — step 4 of six, and the source of measured facts.

`PROJECT.md` §8.2 step 4: list, pull and delete local models. A call to a local
HTTP API, which Rule 1 explicitly permits, and Rule 5 keeps on the setup side —
nothing here is reachable from `/api/chat` and the orchestrator must never
import this module.

## Why this does more than list/pull/delete

`/api/show` reports a model's real architecture: layer count, KV head count,
head dimension, trained context length. That turns the fit estimate from
arithmetic over a parameter count into arithmetic over the actual shape of the
model, and `/api/tags` gives its real size on disk in place of a bytes-per-param
guess. `MODULES.md` §2.2 asks that estimates and measurements never look alike;
this module is where the measurements come from.

It is also what makes the catalogue a seed rather than a closed list. A model
that was never in `model_catalogue.json` still reports its own parameter count
and quantization here, so anything pulled can be scored and recommended.

## Where Ollama is

`OLLAMA_BASE_URL` is `host.docker.internal` so the container can reach the
host's daemon, and that name does not resolve when `./daedalus.sh dev` runs the
backend on the host itself. Every call therefore tries the configured URL and
then localhost, and reports which one answered — the same fallback
`services/hardware.py` uses, and it lives here so the two can never disagree
about where Ollama is.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator
from typing import Any

try:
    import httpx
except Exception:  # pragma: no cover - defensive
    httpx = None  # type: ignore[assignment]

# Listing and showing are local and fast; a hung daemon must not hold a worker.
LIST_TIMEOUT = 5.0
SHOW_TIMEOUT = 10.0
# A pull streams for as long as the download takes. The read timeout applies
# between chunks, not to the whole transfer, so this is "the daemon went quiet",
# not "the model is large".
PULL_READ_TIMEOUT = 60.0


class OllamaError(RuntimeError):
    """Ollama answered, and said no. Carries the daemon's own message."""


class OllamaUnavailable(RuntimeError):
    """Nothing answered on any candidate URL."""


# How long to wait on *connecting*, as opposed to waiting for an answer.
#
# These are separate for a measured reason. `OLLAMA_BASE_URL` defaults to
# `host.docker.internal`, which does not resolve when the backend runs on the
# host in dev mode — so every call paid a full DNS timeout before falling back
# to localhost. With one model installed that made `GET /api/forge/models` take
# 15.2 seconds: five for the tag list, ten for the /api/show behind it, all of
# it spent failing to resolve a name. A connect attempt that is going to fail
# fails within two seconds; a read that is going to succeed still gets as long
# as it needs.
CONNECT_TIMEOUT = 2.0

# The base URL that last answered. Tried first next time, so the dead candidate
# is paid for once per process rather than once per call.
_resolved_base: str | None = None
_resolve_lock = threading.Lock()


def candidate_base_urls() -> list[str]:
    """Where to look for Ollama, best guess first. See the module docstring.

    Three fallbacks, each for a failure that actually happens:

    - **localhost**, because `host.docker.internal` does not resolve when
      `./daedalus.sh dev` runs the backend on the host rather than in a
      container, which is how most development happens.
    - **127.0.0.1**, because `localhost` resolves to `::1` first on a dual-stack
      machine and Ollama binds IPv4 only by default. The connection is refused
      on a machine where the daemon is running perfectly well, which is a
      genuinely confusing way to be told nothing is there.
    - **`host.docker.internal` last** when it is not the configured value, so a
      containerised backend still finds a host daemon if the configuration is
      pointed somewhere else.
    """
    base = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434").rstrip("/")
    candidates = [base]

    def add(url: str) -> None:
        if url not in candidates:
            candidates.append(url)

    # Only when the configured host is already a local alias. A base pointing at
    # a real remote machine is a deliberate choice — the lab box, the other
    # laptop — and quietly answering from a daemon on *this* machine instead
    # would attribute a benchmark to the wrong hardware. If the remote is down,
    # that is worth an error rather than a substitution.
    if any(alias in base for alias in ("host.docker.internal", "localhost", "127.0.0.1")):
        for alias in ("host.docker.internal", "localhost", "127.0.0.1"):
            for replacement in ("localhost", "127.0.0.1", "host.docker.internal"):
                if alias in base:
                    add(base.replace(alias, replacement))

    with _resolve_lock:
        known = _resolved_base
    if known and known in candidates:
        # Move the known-good one to the front rather than returning it alone:
        # if the daemon has moved, the others are still worth trying.
        candidates.remove(known)
        candidates.insert(0, known)
    return candidates


def _remember(base: str) -> None:
    global _resolved_base
    with _resolve_lock:
        _resolved_base = base


def forget_resolved_base() -> None:
    """Drop the cached URL — for a test, or after Ollama is known to have moved."""
    global _resolved_base
    with _resolve_lock:
        _resolved_base = None


def _timeout(read: float) -> Any:
    return httpx.Timeout(connect=CONNECT_TIMEOUT, read=read, write=10.0, pool=CONNECT_TIMEOUT)


def _request(method: str, path: str, *, timeout: float, **kwargs: Any) -> Any:
    """One call against whichever candidate URL answers first.

    A connection failure moves to the next candidate; an HTTP error does not.
    That distinction matters: a 404 from the real daemon is an answer about the
    model, and retrying it against localhost would turn a clear "no such model"
    into a misleading "Ollama is not running".
    """
    if httpx is None:
        raise OllamaUnavailable("httpx is not installed")

    last_error: Exception | None = None
    for base in candidate_base_urls():
        try:
            response = httpx.request(method, f"{base}{path}", timeout=_timeout(timeout), **kwargs)
        except Exception as exc:
            last_error = exc
            continue
        # It answered, even to say no — this is where Ollama lives.
        _remember(base)
        if response.status_code >= 400:
            raise OllamaError(_error_detail(response))
        return response.json() if response.content else {}

    raise OllamaUnavailable(_unavailable_message(last_error))


def _unavailable_message(last_error: Exception | None) -> str:
    """Why nothing answered, and what to do about it.

    "ConnectError" is true and useless. There are only a handful of reasons this
    fails in practice and they have different fixes, so the message names them
    rather than making somebody guess which one they are looking at.
    """
    tried = ", ".join(candidate_base_urls())
    kind = last_error.__class__.__name__ if last_error else "no response"

    base = os.environ.get("OLLAMA_BASE_URL", "").strip()
    is_remote = bool(base) and not any(
        alias in base for alias in ("host.docker.internal", "localhost", "127.0.0.1")
    )

    hint = "Start it with `ollama serve`, or check it is installed."
    if is_remote:
        hint = (
            f"OLLAMA_BASE_URL points at {base}, so only that host was tried. There is no "
            "local fallback, because answering from this machine would attribute results "
            "to the wrong hardware. Check the remote daemon is up and was started with "
            "OLLAMA_HOST=0.0.0.0."
        )
    elif "Connect" in kind or "Timeout" in kind:
        hint = (
            "Check it is running (`ollama list` should answer). "
            "If it runs on another machine or in Docker, Ollama binds 127.0.0.1 "
            "by default and will not accept outside connections, so start it with "
            "OLLAMA_HOST=0.0.0.0 and set OLLAMA_BASE_URL to point at it."
        )

    return f"no Ollama daemon answered on {tried} ({kind}). {hint}"


def _error_detail(response: Any) -> str:
    """Ollama's own message, which is almost always the actionable one.

    "model 'qwen3:1.7b-q8_0' not found" tells somebody exactly what to fix;
    "HTTP 404" does not. The catalogue ships tags that nobody has verified
    against the registry, so this path is not an edge case.
    """
    try:
        body = response.json()
        if isinstance(body, dict) and body.get("error"):
            return str(body["error"])
    except Exception:
        pass
    text = (getattr(response, "text", "") or "").strip()
    return text[:400] if text else f"HTTP {response.status_code}"


def available() -> bool:
    try:
        _request("GET", "/api/version", timeout=2.0)
        return True
    except Exception:
        return False


def list_models() -> list[dict[str, Any]]:
    """Everything pulled locally, with the size and details Ollama reports.

    `size` is the real number of bytes on disk — the measurement that replaces
    `params × bytes_per_param` in the fit estimate.
    """
    data = _request("GET", "/api/tags", timeout=LIST_TIMEOUT)
    models = data.get("models") or []
    out: list[dict[str, Any]] = []
    for model in models:
        details = model.get("details") or {}
        out.append({
            "name": model.get("name"),
            "size_bytes": model.get("size"),
            "digest": model.get("digest"),
            "modified_at": model.get("modified_at"),
            "family": details.get("family"),
            "parameter_size": details.get("parameter_size"),
            "quantization_level": details.get("quantization_level"),
            # Cloud-hosted entries carry a remote host and a placeholder size —
            # they are not on this disk and must never be scored as if they
            # were, nor offered as a local deployment target.
            "remote": bool(model.get("remote_host") or model.get("remote_model")),
        })
    return out


# `/api/show` prefixes every architecture key with the model family, so the
# names are `llama.block_count`, `gemma3.attention.head_count_kv` and so on.
# Matching on the suffix keeps this working for a family nobody has seen yet.
_ARCH_SUFFIXES = {
    "layers": ".block_count",
    "kv_heads": ".attention.head_count_kv",
    "heads": ".attention.head_count",
    "head_dim": ".attention.key_length",
    "context_length": ".context_length",
    "embedding_length": ".embedding_length",
}


def _extract_arch(model_info: dict[str, Any]) -> dict[str, Any]:
    found: dict[str, Any] = {}
    for field, suffix in _ARCH_SUFFIXES.items():
        for key, value in model_info.items():
            if key.endswith(suffix) and isinstance(value, (int, float)):
                found[field] = int(value)
                break

    # Not every family publishes key_length. When it is missing, the standard
    # relation holds for all of these: head_dim = embedding_length ÷ head_count.
    if "head_dim" not in found and found.get("embedding_length") and found.get("heads"):
        found["head_dim"] = int(found["embedding_length"] // found["heads"])
    # Multi-head attention with no GQA reports no head_count_kv; there, the KV
    # head count is simply the attention head count.
    if "kv_heads" not in found and found.get("heads"):
        found["kv_heads"] = int(found["heads"])

    return found


def show(name: str) -> dict[str, Any]:
    """A pulled model's real architecture and parameters.

    `measured: True` travels with it, because `model_fit` treats a measured
    architecture differently from a declared one and the UI says which it used.
    """
    data = _request("POST", "/api/show", timeout=SHOW_TIMEOUT, json={"model": name})
    details = data.get("details") or {}
    arch = _extract_arch(data.get("model_info") or {})
    arch["measured"] = bool(arch.get("layers") and arch.get("kv_heads") and arch.get("head_dim"))
    return {
        "name": name,
        "arch": arch,
        "context_length": arch.get("context_length"),
        "parameter_size": details.get("parameter_size"),
        "quantization_level": details.get("quantization_level"),
        "family": details.get("family"),
        "capabilities": data.get("capabilities") or [],
    }


def delete(name: str) -> bool:
    """Remove a local model. Ollama 404s for one that is not there."""
    _request("DELETE", "/api/delete", timeout=LIST_TIMEOUT, json={"model": name})
    return True


def pull(name: str) -> Iterator[dict[str, Any]]:
    """Stream a pull, yielding normalised progress.

    A generator rather than a blocking call because a 5GB pull is minutes long
    and `MODULES.md` §2.6 names blocking a worker on it as a risk. The caller
    turns these into server-sent events; abandoning the generator closes the
    connection and stops the read.

    Ollama streams NDJSON whose shape changes through the pull — a manifest
    line, then per-layer download lines with `total` and `completed`, then
    verification and success. Normalised here so the UI has one shape to render
    rather than four, with `percent` computed only where it means something.
    """
    if httpx is None:
        raise OllamaUnavailable("httpx is not installed")

    last_error: Exception | None = None
    for base in candidate_base_urls():
        try:
            with httpx.stream(
                "POST",
                f"{base}/api/pull",
                json={"model": name, "stream": True},
                timeout=_timeout(PULL_READ_TIMEOUT),
            ) as response:
                _remember(base)
                if response.status_code >= 400:
                    response.read()
                    raise OllamaError(_error_detail(response))
                for line in response.iter_lines():
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if event.get("error"):
                        raise OllamaError(str(event["error"]))
                    yield _normalise_pull_event(event)
                return
        except (OllamaError, OllamaUnavailable):
            raise
        except Exception as exc:
            # Connection-level failure: try the next candidate. Once bytes have
            # been yielded this is a genuine mid-pull failure, but the caller
            # sees the stream stop either way and Ollama resumes from the
            # layers already on disk on the next attempt.
            last_error = exc
            continue

    raise OllamaUnavailable(_unavailable_message(last_error))


def _normalise_pull_event(event: dict[str, Any]) -> dict[str, Any]:
    status = str(event.get("status") or "")
    total = event.get("total")
    completed = event.get("completed")
    percent: float | None = None
    if isinstance(total, int) and isinstance(completed, int) and total > 0:
        percent = round(min(100.0, completed / total * 100.0), 1)
    return {
        "status": status,
        "digest": event.get("digest"),
        "total_bytes": total,
        "completed_bytes": completed,
        "percent": percent,
        # Ollama signals completion with a bare {"status": "success"}.
        "done": status == "success",
    }
