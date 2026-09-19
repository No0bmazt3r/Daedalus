"""Everything else the orchestrator needs in order to answer safely.

Two tools, both small, both there because of a rule rather than a feature.

`get_current_time` exists because of Rule 3. *"What happened at 10:00 today"*
cannot be turned into a query without knowing what today is, and a model that
supplies the date from its own head has invented the first number in the chain —
every trend window built on it is then wrong in a way that looks right. The
clock is a tool for the same reason a sensor reading is.

`ask_user` exists because of the safety guard. §7.1 step 4 refuses control
intent outright, but the more common case is a question that is merely
ambiguous — *"is the pressure OK?"* with no unit, no time and no loop named.
Guessing produces a confident answer to a question nobody asked. This gives the
orchestrator a third option besides answering and refusing.

Odysseus' `other` also holds `bash`, `python`, `write_file` and `ui_control`.
None of those exist here and none are wanted — the tool layer is deterministic
and read-only by design (§7.2), which is the property that makes an answer
replayable from its logs.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .registry import Effect, Param, ToolError, register

_MAX_OPTIONS = 5


@register(
    name="get_current_time",
    category="other",
    summary=(
        "The current date and time on this machine. Needed before any relative time "
        "window — 'today', 'the last hour' — can be turned into a query."
    ),
    effects={Effect.CLOCK},
    params=(),
)
def get_current_time() -> dict[str, Any]:
    """UTC, with the local offset alongside it.

    Both, because the two readers need different things: sensor rows are stored
    in UTC and a trend window must match them, while an operator reading *"at
    14:05"* means the clock on the wall. Returning only one guarantees that
    somebody converts it wrongly later.
    """
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone()
    return {
        "data": {
            "utc": now_utc.isoformat(timespec="seconds"),
            "local": now_local.isoformat(timespec="seconds"),
            "timezone": str(now_local.tzinfo),
            "unix": int(now_utc.timestamp()),
        },
        "detail": f"{now_local.strftime('%Y-%m-%d %H:%M:%S %Z')} (UTC {now_utc.strftime('%H:%M:%S')})",
    }


@register(
    name="ask_user",
    category="other",
    summary=(
        "Ask the operator one clarifying question instead of guessing — which sensor, "
        "which time window, which procedure."
    ),
    effects={Effect.USER_INTERACTION},
    params=(
        Param("question", str, "The single question to ask.", required=True, max_length=300,
              example="Which reactor unit do you mean?"),
        Param("options", list, "Up to five suggested answers, if there is a short list.",
              default=None),
    ),
)
def ask_user(question: str, options: list | None) -> dict[str, Any]:
    """Returns a request, not an answer.

    Nothing is executed and nobody is blocked: the orchestrator receives
    `awaiting_user` and decides how to surface it. Doing it any other way would
    put a synchronous wait for a human inside a path with a <3s latency target.
    """
    question = question.strip()
    if not question:
        raise ToolError("question cannot be empty")

    cleaned = []
    for option in (options or [])[:_MAX_OPTIONS]:
        text = str(option).strip()[:120]
        if text:
            cleaned.append(text)

    return {
        "data": {"question": question, "options": cleaned, "awaiting_user": True},
        "detail": "waiting on the operator",
    }
