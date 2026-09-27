"""The background summariser — PROJECT.md §7.4's rolling summary.

`chat_service.build_context` keeps the newest turns that fit the history budget
and reports the rest as `dropped`. Without this module those turns simply
vanished from the model's view: the operator's question from twenty minutes ago
("the NDIR on the absorber outlet") was no longer a referent anything could
resolve. This folds them into `chat_sessions.summary`, which `build_context`
already replays ahead of the recent turns.

## After the answer, never on the request path

Summarising is another model call. §7.4 is explicit that it runs *after* the
response is sent, because inline it would spend the latency budget the answer
is measured against. `schedule()` starts a daemon thread once the `done` event
is out; the operator never waits for it. It may still share Ollama with the
next question if one arrives within seconds — Ollama serialises the two — which
is the accepted cost of having one local model.

## Referents, not values

The summary is replayed into every later prompt, and it is not evidence. A
number in it is exactly §7.4's hazard: true when it was said, never re-fetched,
and quotable. So the model is told to leave values out, and then every quantity
it wrote anyway is **redacted** (`numbers.redact`) before storing — the prompt
asks, the redaction guarantees. The validator also treats the summary as
history, so a number that somehow survived would be flagged as stale.

## Always local, and a floor when there is no model

It uses `query_pipeline.local_model`, the committed local model — never a
per-turn cloud override, which the operator chose for an *answer* and not for
sending the whole transcript off the machine. With no local model, or on any
failure, it falls back to a deterministic summary: the operator's own earlier
questions, in order. That loses the assistant's side but keeps every referent,
and it is never wrong about what was asked.

Every run writes one `memory_logs` row (`kind='summary'`) with how it was made,
so a summary in a prompt can be traced to the turns it came from.
"""

from __future__ import annotations

import logging
import threading
import uuid
from typing import Any

from ..db import audit_store, chat_store
from . import chat_service
from .orchestration import numbers
from .query_pipeline import local_model

log = logging.getLogger("daedalus.summariser")

# A summary is a paragraph, not a transcript. Stored capped by chat_store too.
MAX_SENTENCES = 5
_TURN_CHARS = 600
_FALLBACK_QUESTIONS = 8
# Longer than the pipeline's one-line steps: this writes a paragraph, and
# nobody is waiting on it.
TIMEOUT_S = 90.0

_SYSTEM = (
    "You keep a running summary of an operator's conversation with a read-only monitoring "
    "assistant for a CO2 sorption reactor. Merge the previous summary with the new turns into "
    f"at most {MAX_SENTENCES} short sentences saying what the operator asked about — which "
    "sensors, time periods, anomalies, equipment or procedures — and what they were trying to "
    "find out. Do NOT include any measured value, reading or number: they go stale. Reply with "
    'JSON {"summary": "<text>"} and nothing else.'
)

_running: set[str] = set()
_lock = threading.Lock()


def schedule(session_id: str) -> bool:
    """Start a summarisation pass in the background. False if one is already running."""
    with _lock:
        if session_id in _running:
            return False
        _running.add(session_id)

    def _run() -> None:
        try:
            summarise(session_id)
        except Exception as exc:  # noqa: BLE001 — a background pass must never surface
            log.warning("summarising %s failed: %s", session_id, exc)
        finally:
            with _lock:
                _running.discard(session_id)

    threading.Thread(target=_run, name=f"summarise-{session_id[:8]}", daemon=True).start()
    return True


def _turn_line(message: dict[str, Any]) -> str:
    who = "Operator" if message["role"] == "user" else "Assistant"
    text = message.get("standalone_query") or message["content"]
    return f"{who}: {' '.join(str(text).split())[:_TURN_CHARS]}"


def _fallback(previous: str | None, folded: list[dict[str, Any]]) -> str:
    asked = [
        " ".join(str(m.get("standalone_query") or m["content"]).split())[:160]
        for m in folded if m["role"] == "user"
    ][-_FALLBACK_QUESTIONS:]
    parts = [previous.strip()] if previous else []
    if asked:
        parts.append("Earlier the operator asked: " + "; ".join(asked) + ".")
    return " ".join(parts)


def summarise(session_id: str) -> dict[str, Any] | None:
    """Fold the turns that fell out of the window into the rolling summary.

    Returns what was written, or None when nothing had fallen out. Synchronous —
    `schedule()` is the way to call it from the chat path.
    """
    window = chat_service.build_context(session_id)
    if not window.dropped:
        return None

    upto = window.oldest_kept_seq - 1
    folded = [
        m for m in chat_store.get_messages(session_id, after_seq=window.summary_upto_seq)
        if m["seq"] <= upto
    ]
    if not folded:
        return None

    prompt = (
        f"Previous summary: {window.summary or '(none)'}\n\n"
        "Turns to fold in:\n" + "\n".join(_turn_line(m) for m in folded)
    )
    data, tag = local_model.ask_json(_SYSTEM, prompt, max_tokens=220, timeout=TIMEOUT_S)
    text = str((data or {}).get("summary") or "").strip()
    method = "model" if text else "fallback"
    if not text:
        text = _fallback(window.summary, folded)

    clean = numbers.redact(text)
    chat_service.record_summary(session_id, clean, upto)
    audit_store.log(
        "memory_logs",
        memory_id=f"sum_{uuid.uuid4().hex[:12]}",
        session_id=session_id,
        kind="summary",
        content=clean,
        # How it was made and what it covers — enough to trace a summary in a
        # prompt back to the turns it replaced.
        source=f"{method}:{tag or 'none'} seq {window.summary_upto_seq + 1}-{upto}"
               + (" · values redacted" if clean != text else ""),
    )
    return {"summary": clean, "upto_seq": upto, "method": method, "model": tag, "folded": len(folded)}
