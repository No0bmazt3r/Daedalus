"""The query pipeline's two short model calls, and the rules they run under.

Follow-up rewriting and the intent tiebreaker are the only places before the
answer where a model runs, and each is a fallback: both stages try their rules
first and call a model only when the rules cannot decide. So everything here is
built to fail quietly — any error, timeout or malformed reply returns None, and
the caller keeps what the rules produced.

## Always the local model

These calls use `model_config.resolve()` — the committed, local model — even
when the operator has pointed the chat at a cloud model for this turn. That
override is recorded against the *answer* (`chat_cloud`); sending the
conversation to a cloud model just to rewrite a follow-up would be an
unrecorded exposure the override never asked for. No local model installed
means no model step, not a fallback to cloud.

## Short, and thinking off

A reasoning model (qwen3, gpt-oss) spends seconds thinking before it answers,
which is right for the answer and wrong for relabelling a question. `think` is
switched off for models that support it, and the reply is capped, so the step
costs a fraction of a second on the development machine rather than the
latency budget §9.2 measures the whole turn against.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

from .. import model_config, ollama_client

log = logging.getLogger("daedalus.pipeline")

# Well past a warm SLM's time for a one-line JSON reply, well short of letting a
# cold load hold the turn. On timeout the rules' answer stands.
TIMEOUT_S = 12.0

_thinking: dict[str, bool] = {}
_lock = threading.Lock()


def _supports_thinking(tag: str) -> bool:
    with _lock:
        if tag in _thinking:
            return _thinking[tag]
    try:
        capable = "thinking" in (ollama_client.show(tag).get("capabilities") or [])
    except Exception:  # noqa: BLE001
        capable = False
    with _lock:
        _thinking[tag] = capable
    return capable


def local_tag() -> str | None:
    """The committed local model, or None when there is none to call."""
    try:
        return model_config.resolve().get("tag")
    except Exception:  # noqa: BLE001
        return None


def ask_json(
    system: str, prompt: str, *, max_tokens: int = 120, timeout: float = TIMEOUT_S
) -> tuple[dict[str, Any] | None, str | None]:
    """One JSON object from the local model, and the tag that produced it.

    Returns (None, tag-or-None) on any failure. Never raises.
    """
    tag = local_tag()
    if not tag:
        return None, None
    try:
        raw = ollama_client.generate(
            tag,
            prompt,
            system=system,
            json_format=True,
            temperature=0.0,
            timeout=timeout,
            think=False if _supports_thinking(tag) else None,
            max_tokens=max_tokens,
        )
        data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001 — a fallback that fails is a no-op
        log.info("pipeline model step skipped (%s): %s", tag, exc)
        return None, tag
    return (data if isinstance(data, dict) else None), tag
