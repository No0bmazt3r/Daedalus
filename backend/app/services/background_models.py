"""Which model runs each background job, and how the title job behaves.

Two jobs run after an answer, on their own threads, with nobody waiting:

| job | what it writes | where it is replayed |
|---|---|---|
| `title` | the chat's sidebar name (`session_titles`) | nowhere — a label for the operator |
| `summary` | the rolling summary (`summariser`) | into every later prompt of that chat |

Both used whatever model answered chat. That is the wrong default in two
directions at once: a 1.7B model that answers acceptably writes a mediocre
title, and a 14B model that answers well spends seconds of GPU on a five-word
label while the operator's next question queues behind it. So each job names
its own model here, or says `auto` to follow the committed chat model.

## Local only, stated rather than assumed

A background job sends the conversation — every question, every answer — to
its model. The chat picker can point an *answer* at a cloud model, and that is
recorded per turn (`chat_cloud`); a background job has no turn to record it
against, and the operator is not looking when it runs. So only models on this
machine are offered and accepted. A tag that is no longer installed falls back
to `auto` and `resolve` says so, rather than silently running something else
or failing the job.

## A file, like the other two

`config/background_jobs.json`, written the same way as `model_config.json` and
`rag_config.json`. The summary model changes what later prompts contain, so it
is part of what produced a result, and has to be readable in a diff afterwards.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
from typing import Any

from ..db import paths
from . import model_config, ollama_client

log = logging.getLogger("daedalus.background")

CONFIG_PATH = paths.CONFIG_DIR / "background_jobs.json"

JOBS = ("title", "summary")
TITLE_MODES = ("model", "first_message")
AUTO = "auto"
MAX_REFRESH_EVERY = 50

DEFAULT: dict[str, Any] = {
    "title": {
        # A model-written title by default: the first message was the old
        # behaviour, and it names a chat by its least representative line.
        "mode": "model",
        "model": AUTO,
        # Rename again after this many further operator turns; 0 names it once.
        "refresh_every": 4,
    },
    "summary": {"model": AUTO},
}

_lock = threading.Lock()
# Capabilities per (tag, digest). `/api/show` is a round trip per model, and the
# panel asks on every open; the digest changes when the weights under a tag do.
_capabilities: dict[tuple[str, str], list[str]] = {}


def _clean(raw: Any) -> dict[str, Any]:
    """`raw` coerced onto the schema; anything unrecognised takes the default."""
    out = json.loads(json.dumps(DEFAULT))
    if not isinstance(raw, dict):
        return out
    title = raw.get("title") if isinstance(raw.get("title"), dict) else {}
    if title.get("mode") in TITLE_MODES:
        out["title"]["mode"] = title["mode"]
    if isinstance(title.get("model"), str) and title["model"].strip():
        out["title"]["model"] = title["model"].strip()
    every = title.get("refresh_every")
    if isinstance(every, int) and not isinstance(every, bool) and 0 <= every <= MAX_REFRESH_EVERY:
        out["title"]["refresh_every"] = every
    summary = raw.get("summary") if isinstance(raw.get("summary"), dict) else {}
    if isinstance(summary.get("model"), str) and summary["model"].strip():
        out["summary"]["model"] = summary["model"].strip()
    return out


def read() -> dict[str, Any]:
    """The config as written. Missing or malformed reads as the default; never raises."""
    try:
        return _clean(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return _clean(None)


def write(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate and commit. Raises ValueError naming what was wrong."""
    if not isinstance(raw, dict):
        raise ValueError("expected an object with 'title' and/or 'summary'")
    current = read()
    merged = {job: {**current[job], **(raw.get(job) or {})} for job in JOBS}

    title = merged["title"]
    if title.get("mode") not in TITLE_MODES:
        raise ValueError(f"title.mode must be one of {TITLE_MODES}")
    every = title.get("refresh_every")
    if not isinstance(every, int) or isinstance(every, bool) or not 0 <= every <= MAX_REFRESH_EVERY:
        raise ValueError(f"title.refresh_every must be a whole number from 0 to {MAX_REFRESH_EVERY}")

    local = {m["name"] for m in local_models()}
    for job in JOBS:
        tag = merged[job].get("model")
        if not isinstance(tag, str) or not tag.strip():
            raise ValueError(f"{job}.model must be 'auto' or an installed model")
        # Only checked when Ollama answered at all — refusing every save while
        # it is down would lock the setting exactly when you might fix it.
        if tag != AUTO and local and tag not in local:
            raise ValueError(
                f"{tag} is not a local model that can generate text. Background jobs run on "
                "this machine only — see Settings → Background Jobs."
            )

    payload = _clean(merged)
    with _lock:
        paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=paths.CONFIG_DIR, prefix=".background_jobs-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, CONFIG_PATH)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
    return payload


def local_models() -> list[dict[str, Any]]:
    """Installed, on this machine, and able to complete a prompt.

    The same filter `model_config.resolve` applies to `auto`: an embedding model
    is small and installed, and would otherwise be offered to write a title.
    """
    out: list[dict[str, Any]] = []
    try:
        listed = ollama_client.list_models()
    except Exception:  # noqa: BLE001 — Ollama down is an empty list, not an error
        return out
    for m in listed:
        name = m.get("name")
        if not name or m.get("remote"):
            continue
        key = (name, str(m.get("digest")))
        capabilities = _capabilities.get(key)
        if capabilities is None:
            try:
                capabilities = list(ollama_client.show(name).get("capabilities") or [])
                _capabilities[key] = capabilities
            except Exception:  # noqa: BLE001 — unknown is "not offered", and asked again next time
                capabilities = []
        if "completion" not in capabilities:
            continue
        out.append({"name": name, "size": m.get("size_bytes"),
                    "parameter_size": m.get("parameter_size")})
    return out


def resolve(job: str, *, installed: set[str] | None = None) -> dict[str, Any]:
    """The tag a job should run on now, and why. `tag` None means no model."""
    if job not in JOBS:
        raise ValueError(f"unknown job {job!r}")
    chosen = read()[job]["model"]
    if chosen != AUTO:
        if installed is None:
            installed = {m["name"] for m in local_models()}
        if chosen in installed:
            return {"tag": chosen, "source": "configured", "reason": f"set to {chosen}"}
        fallback = _auto()
        return {
            **fallback,
            "source": "fallback",
            "reason": f"{chosen} is not installed on this machine, so the chat model is used: "
                      f"{fallback['reason']}",
        }
    return _auto()


def configured_tag(job: str) -> str | None:
    """The job's own model when one is set and installed; None means "the chat model".

    What the jobs themselves call. Unlike `resolve`, it never scores models for
    `auto` — `local_model.ask_json` already resolves the chat model when handed
    None, and doing it twice would cost the job a second fit-scoring pass.
    """
    chosen = read()[job]["model"]
    if chosen == AUTO:
        return None
    if chosen in {m["name"] for m in local_models()}:
        return chosen
    log.info("%s job: %s is not installed locally; using the chat model", job, chosen)
    return None


def _auto() -> dict[str, Any]:
    try:
        resolved = model_config.resolve()
    except Exception as exc:  # noqa: BLE001
        return {"tag": None, "source": "auto", "reason": f"the chat model could not be resolved ({exc})"}
    tag = resolved.get("tag")
    return {
        "tag": tag,
        "source": "auto",
        "reason": f"follows the chat model ({tag})" if tag else resolved.get("reason", "no local model"),
    }


def status() -> dict[str, Any]:
    """Everything the Settings panel shows, in one call."""
    models = local_models()
    installed = {m["name"] for m in models}
    return {
        "config": read(),
        "models": models,
        "resolved": {job: resolve(job, installed=installed) for job in JOBS},
        "path": str(CONFIG_PATH),
    }
