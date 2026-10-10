"""Chat titles written from the conversation, not copied from its first line.

A chat used to be named by its opening message, cut to 60 characters, forever.
For a console whose chats are troubleshooting sessions that is the worst line
to pick: "hi" or "what's the CO2 now?" opens a conversation that ends up being
about a pressure excursion during desorption, and the sidebar history — the
thing that is supposed to let you find that conversation again — says "hi".

So after an answer is stored, a background job asks a model for a short title
from the conversation so far, and optionally asks again as the chat grows. The
first message is still used the instant a chat starts, as a placeholder, so the
sidebar never shows an empty row while the job runs.

## When it runs

`schedule()` is called after every stored answer and decides nothing itself;
`_due()` does, from the session row:

- never on a chat the operator named (`title_source = 'user'`), and never in
  incognito — those chats are not listed, so a title would be work for nobody;
- once there is at least one answer, if the chat has no model title yet;
- again after `refresh_every` more operator turns (Settings → Background Jobs),
  so a chat that drifted gets a name for where it went. `0` names it once.

`force=True` (the sidebar's "Regenerate title") skips the turn arithmetic but
not the two "never"s, except that it does reclaim a title the operator typed —
asking for a new one is the operator changing their mind.

## Referents, not readings

Same rule as the summariser, for a smaller reason. A title is not replayed into
a prompt, but it sits in the sidebar for weeks, and "CO₂ at 1,020 ppm" reads as
a current value every time somebody scrolls past it. The model is told to leave
values out, and any quantity it writes anyway is removed before storing. Clock
times survive: "spike at 10:30" names a moment, not a measurement.

## The model

`background_models.resolve("title")` — a local model, chosen in Settings or
following the chat model. With none, the job does nothing and the first-message
title stands, which is exactly the old behaviour rather than a failure.
"""

from __future__ import annotations

import logging
import re
import threading
from typing import Any

from ..db import audit_store, chat_store
from . import background_models, live_events
from .orchestration import numbers
from .query_pipeline import local_model

log = logging.getLogger("daedalus.titles")

MAX_TITLE_CHARS = chat_store.TITLE_CHARS
_TURNS_SHOWN = 10
_TURN_CHARS = 280
TIMEOUT_S = 45.0

_SYSTEM = (
    "You name conversations between an operator and a read-only monitoring assistant for a CO2 "
    "sorption reactor. Write a title of 3 to 7 words saying what the conversation is about — the "
    "sensors, equipment, procedures or time periods it covers. If it moved on from where "
    "it started, name where it is now. No measured values or numbers other than clock times, no "
    "quotes, no trailing full stop. Use the language the operator writes in. Reply with JSON "
    '{"title": "<title>"} and nothing else.'
)

# "reaching 1,020 ppm" → "", not "reaching".
_DANGLING_RE = re.compile(
    r"(?:\s+(?:at|of|to|by|reaching|reached|reaches|around|about|approximately|approx|near|hitting|hit|hits"
    r"|over|under|above|below|exceeding|exceeded|exceeds|peaking|peaked|of\s+about|pada|sekitar|melebihi)"
    r"|\s*[=~≈])?\s*\x00",
    re.IGNORECASE,
)

_running: set[str] = set()
_lock = threading.Lock()


def pending(session_id: str) -> bool:
    """A title job is running for this chat right now (the sidebar shows it loading)."""
    with _lock:
        return session_id in _running


def schedule(session_id: str, *, force: bool = False) -> bool:
    """Start the title job in the background. False if one is already running."""
    with _lock:
        if session_id in _running:
            return False
        _running.add(session_id)

    def _run() -> None:
        try:
            retitle(session_id, force=force)
        except Exception as exc:  # noqa: BLE001 — a background job must never surface
            log.warning("titling %s failed: %s", session_id, exc)
            audit_store.log_error("session_titles", exc, level="warning")
        finally:
            with _lock:
                _running.discard(session_id)
            # Always, not only when a title was written: the sidebar shows this
            # chat loading while the job runs, and has to hear that it ended.
            live_events.publish("sessions", session_id=session_id)

    threading.Thread(target=_run, name=f"title-{session_id[:8]}", daemon=True).start()
    return True


def _due(session: dict[str, Any], user_turns: int, answers: int, refresh_every: int, force: bool) -> bool:
    if session.get("ephemeral") or answers == 0:
        return False
    source = session.get("title_source")
    if force:
        return True
    if source == "user":
        return False
    if source != "model":
        return True
    return refresh_every > 0 and user_turns - int(session.get("title_turns") or 0) >= refresh_every


def _line(message: dict[str, Any]) -> str:
    who = "Operator" if message["role"] == "user" else "Assistant"
    text = message.get("standalone_query") or message["content"]
    return f"{who}: {' '.join(str(text).split())[:_TURN_CHARS]}"


def clean(raw: str) -> str:
    """A model's title, made safe to show: one line, no values, no wrapping punctuation."""
    text = " ".join(str(raw).split())
    text = re.sub(r"^(?:title\s*[:\-]\s*)", "", text, flags=re.IGNORECASE)
    text = text.strip(" \"'`“”‘’*#")
    # Quantities out, keeping small counts and clock times; then tidy what the
    # removal left behind ("CO2 at  ppm" → "CO2").
    text = numbers.redact(text, mask="\x00")
    text = re.sub(  # the unit goes with its value…
        r"\x00(\s*)([^\s,.;:]*)",
        lambda m: "\x00" if m.group(2).lower() in numbers.UNITS else "\x00" + m.group(1) + m.group(2),
        text,
    )
    text = _DANGLING_RE.sub("", text)  # …and so does the word that led into it
    text = re.sub(r"\s+(?:at|of|to|=|~)\s*$", "", " ".join(text.split()), flags=re.IGNORECASE)
    text = text.rstrip(" .,;:-")
    if len(text) > MAX_TITLE_CHARS:
        text = text[: MAX_TITLE_CHARS - 1].rstrip() + "…"
    return text


def retitle(session_id: str, *, force: bool = False) -> dict[str, Any] | None:
    """Name one chat now, if it is due. Returns what was written, or None.

    Synchronous — `schedule()` is the way to call it from the chat path.
    """
    config = background_models.read()["title"]
    if config["mode"] != "model":
        return None

    session = chat_store.get_session(session_id)
    if session is None:
        return None
    messages = chat_store.get_messages(session_id)
    user_turns = sum(1 for m in messages if m["role"] == "user")
    answers = sum(1 for m in messages if m["role"] == "assistant")
    if not _due(session, user_turns, answers, config["refresh_every"], force):
        return None

    # None means the chat model, resolved inside `ask_json`; with no model at
    # all the call returns nothing and the first-message title stands.
    chosen = background_models.configured_tag("title")
    parts = []
    if session.get("summary"):
        parts.append(f"Summary of earlier conversation: {session['summary']}")
    if session.get("title"):
        parts.append(f"Current title: {session['title']}")
    parts.append("Conversation:\n" + "\n".join(_line(m) for m in messages[-_TURNS_SHOWN:]))
    data, tag = local_model.ask_json(_SYSTEM, "\n\n".join(parts), max_tokens=40,
                                     timeout=TIMEOUT_S, tag=chosen)
    title = clean((data or {}).get("title") or "")
    if not title:
        return None

    if force and session.get("title_source") == "user":
        # Reclaimed on request: clear the operator's mark so the conditional
        # write below may replace it.
        chat_store.update_session(session_id, title=None)
    if not chat_store.set_generated_title(session_id, title, user_turns):
        return None  # renamed by the operator while the model was thinking
    live_events.publish("sessions", session_id=session_id)
    return {"title": title, "model": tag, "turns": user_turns}
