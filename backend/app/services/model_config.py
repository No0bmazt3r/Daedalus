"""The committed model choice — step 6 of six, and the reason nothing is hardcoded.

`PROJECT.md` §8.1: *"Selected via `config/model_config.json` — never hardcoded."*
§8.2 step 6: *"Write the chosen model to config for FastAPI to consume."*

## Two ways to choose, and why `auto` is the interesting one

A pinned choice is the obvious design: the Forge writes a model name, FastAPI
reads it. It is also brittle in exactly the way this project cannot afford — the
name is written against one machine's hardware, and the evaluation runs on
whatever machine is free. A config that says `qwen3:8b` is a statement about a
32GB workstation that becomes false, silently, the moment it is read on an 8GB
laptop.

So the config records a **policy**, not just a name:

| mode | meaning |
|---|---|
| `pinned` | Run this exact model. The choice is the operator's and stands |
| `auto` | Run whichever installed model scores highest on *this* machine, now |

`auto` re-runs the fit scorer at resolve time against live hardware and the
models actually pulled. Move the project to a bigger machine and pull a bigger
model, and it follows; run it on a laptop with only a 1.7B model pulled, and it
follows there too, rather than failing on a name that no longer applies.

Both modes resolve through `resolve()`, so a caller never has to know which is
configured — it asks what to run and gets an answer with its reasoning attached.

## What resolution may and may not do

It may only ever return a model that is **actually installed**. An estimate says
a model would fit; it does not put the weights on the disk. `auto` therefore
ranks the installed set, never the catalogue — recommending a model to pull is
the models table's job, and running one is this module's.

## No UI writes this any more

There was a Deployment tab. It was removed because it set a value the chat
composer's own model picker already sets, and two controls for one decision is
how they drift apart.

What remains is the part that could not live in a browser: something has to
answer when no browser is choosing. A scripted run, the M8 evaluation harness,
the first request after a restart before anyone touches the picker — all of
them resolve through here. The default is `auto`, so on a fresh checkout that
means "the best-scoring installed model for whatever machine this is" rather
than a name somebody typed on different hardware.

`write()` is kept and still used by the tests. Pinning is now a hand edit of
`config/model_config.json`, which is the right weight for it: pinning is what
you do to make an experiment reproducible, and that belongs in a file under
version control rather than behind a button.

Rule 5 still holds: the read path is `resolve()`, which the orchestrator may
call. Nothing here reaches back into the Forge.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from typing import Any

from ..db import paths

SCHEMA_VERSION = 1

# Serialises read-modify-write. Two people committing a choice at once is not a
# realistic load, but a half-written config read by the orchestrator is a
# genuinely bad failure, and a lock is cheaper than reasoning about it.
_write_lock = threading.Lock()

_DEFAULT: dict[str, Any] = {
    "schema_version": SCHEMA_VERSION,
    # Auto by default: on a fresh checkout nobody has chosen anything, and
    # "the best model this machine has" is a better default than a name picked
    # by whoever wrote the file.
    "mode": "auto",
    "pinned": None,
    "updated_at": None,
    "updated_by": None,
    "note": None,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read() -> dict[str, Any]:
    """The config as written. Missing or malformed reads as the default.

    Never raises. A corrupt config must not take down the orchestrator — it
    falls back to `auto`, which is the mode that needs no stored state to work.
    """
    try:
        with open(paths.MODEL_CONFIG, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            raise ValueError("not an object")
    except (OSError, ValueError):
        return dict(_DEFAULT)

    config = dict(_DEFAULT)
    config.update({k: v for k, v in data.items() if k in _DEFAULT})
    if config.get("mode") not in {"auto", "pinned"}:
        config["mode"] = "auto"
    return config


def write(
    *,
    mode: str,
    tag: str | None = None,
    quantization: str | None = None,
    note: str | None = None,
    updated_by: str = "forge",
) -> dict[str, Any]:
    """Commit a choice. Returns the config as written.

    Atomic — written to a temporary file in the same directory and renamed over
    the target, so a reader either sees the old config or the new one and never
    a partial write. `os.replace` is atomic within a filesystem, which is why
    the temporary file must be a sibling rather than in /tmp.
    """
    if mode not in {"auto", "pinned"}:
        raise ValueError(f"mode must be 'auto' or 'pinned', not {mode!r}")
    if mode == "pinned" and not tag:
        raise ValueError("pinned mode needs a tag")

    config = {
        "schema_version": SCHEMA_VERSION,
        "mode": mode,
        "pinned": {"tag": tag, "quantization": quantization} if mode == "pinned" else None,
        "updated_at": _now(),
        "updated_by": updated_by,
        "note": note,
    }

    with _write_lock:
        paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(
            dir=paths.CONFIG_DIR, prefix=".model_config-", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(config, fh, indent=2)
                fh.write("\n")
                # The rename is atomic; the write behind it is not, unless it
                # has actually reached the disk first.
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, paths.MODEL_CONFIG)
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    return config


def resolve(*, context_tokens: int | None = None) -> dict[str, Any]:
    """What to actually run right now, and why.

    The one function the orchestrator needs. Always answers, including when
    nothing is installed — `tag` is then None and `reason` says what is wrong,
    which is a better contract than an exception the chat path has to catch.

    Imports the fit machinery lazily. This module is on the runtime read path
    and `auto` is the only mode that needs a scorer; a pinned deployment should
    not pay to import one, nor fail to start if the catalogue is missing.
    """
    config = read()
    mode = config["mode"]

    try:
        from . import forge as forge_service
    except Exception as exc:  # pragma: no cover - defensive
        return {
            "mode": mode,
            "tag": (config.get("pinned") or {}).get("tag"),
            "resolved": False,
            "reason": f"fit scorer unavailable ({exc.__class__.__name__})",
            "candidates_considered": 0,
            "config": config,
        }

    installed = forge_service.installed_rows(context_tokens=context_tokens)

    if mode == "pinned":
        pinned = config.get("pinned") or {}
        tag = pinned.get("tag")
        match = next((row for row in installed if row["tag"] == tag), None)
        return {
            "mode": "pinned",
            "tag": tag,
            "resolved": match is not None,
            # A pinned model that is not installed is reported, not silently
            # replaced. Quietly running something other than what the config
            # names would make every logged latency number unattributable.
            "reason": (
                f"pinned to {tag}"
                if match
                else f"pinned to {tag}, which is not installed. Pull it, or switch to auto."
            ),
            "row": match,
            "candidates_considered": len(installed),
            "config": config,
        }

    # auto — rank what is installed and take the best that actually fits.
    #
    # The capability filter is not decoration. `installed_rows()` returns every
    # Ollama model on the machine, and since the Knowledge Base can pull
    # embedding models, that now includes things that cannot complete a prompt at
    # all. An embedder is small, so it scores "safe" and enters the ranking; on a
    # machine where it is the only model pulled it would win, and the chat path
    # would ask `nomic-embed-text` for a completion.
    #
    # Filtered on the presence of `completion` rather than the absence of
    # `embedding`, so a model reporting neither — a capability Ollama adds later,
    # or a tag whose `/api/show` failed — is excluded rather than assumed usable.
    runnable = [
        row
        for row in installed
        if row["verdict"]["fit"] in {"safe", "marginal"}
        and not row.get("remote")
        and "completion" in (row.get("capabilities") or [])
    ]
    if not runnable:
        # Three different problems, and saying "nothing fits" for all of them
        # sends the reader to the wrong fix. A machine holding only an embedding
        # model has plenty of room; what it lacks is anything that can answer.
        fits = [r for r in installed if r["verdict"]["fit"] in {"safe", "marginal"}]
        if not installed:
            reason = "no models are installed. Pull one from the Models tab."
        elif not fits:
            reason = "no installed model fits this machine"
        else:
            reason = (
                f"{len(fits)} installed model(s) fit this machine, but none can generate text "
                "— an embedding model cannot answer a query. Pull a chat model in the Forge."
            )
        return {
            "mode": "auto",
            "tag": None,
            "resolved": False,
            "reason": reason,
            "row": None,
            "candidates_considered": len(installed),
            "config": config,
        }

    best = runnable[0]
    return {
        "mode": "auto",
        "tag": best["tag"],
        "resolved": True,
        "reason": (
            f"best fit of {len(runnable)} installed model(s) on this machine: "
            f"scored {best['score']}, {best['verdict']['fit']}"
        ),
        "row": best,
        "candidates_considered": len(installed),
        "config": config,
    }
