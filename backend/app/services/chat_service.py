"""Conversation state: session lifecycle and context-window assembly.

Two jobs, and they are the two halves of "the assistant remembers":

- **Session lifecycle** — create, list, rename, archive, delete. Mostly thin
  over `chat_store`, but it owns the policy decisions (what incognito means,
  what happens on shutdown) so the router does not.
- **Context assembly** — `build_context()` turns a stored transcript into the
  messages that go into a prompt, inside a token budget.

The orchestrator calls this module directly. It never goes through the HTTP
API to reach conversation state; that would make an internal operation depend
on the web layer being up.

## The rule that shapes `build_context`

Rule 3 says numbers come from tools, never from the model. Replayed history is
the subtle way that breaks: turn 3 said "CO₂ is 470.2 ppm", and at turn 9 the
model has a number in its context that it did not fetch — one that was true
twenty minutes ago and may not be now. It will happily reuse it.

So history is replayed for **referents, not facts**. Three defences:

1. `evidence_json` is never replayed — only the natural-language text is.
2. Every historical assistant turn is stamped with the time it was said, and
   `HISTORY_NOTICE` tells the model what that stamp means.
3. Groundedness validation (Layer 7) checks the answer's numbers against the
   *current* evidence pack only. A number that appears only in history sets
   `hallucination_flag`.

The third is the one that actually measures the problem; the first two reduce
how often it happens.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..db import chat_store

# How much of the context window history may occupy.
#
# The SLM tier (Qwen3 1.7B, Phi-3 Mini, Gemma 3 1B) runs at num_ctx 4096–8192,
# and the evidence pack plus retrieved SOP chunks already claim 1–2k of that.
# ~1200 tokens leaves room for both and still holds four to six turns.
#
# This is a *character-derived estimate* — see chat_store.CHARS_PER_TOKEN.
# Calibrate against the real prompt_eval_count in model_logs before trusting
# it at the edge of a context window.
DEFAULT_HISTORY_TOKEN_BUDGET = 1_200

# Prepended to replayed history. Short on purpose: a small model follows one
# clear sentence better than a paragraph of caveats.
HISTORY_NOTICE = (
    "The following turns are earlier parts of this conversation, shown so you "
    "can resolve references like \"it\" or \"that reading\". Each is marked with "
    "the time it was said. Any value mentioned in them was true only at that "
    "time and may now be stale. Never answer using a number from this history "
    "— use only the EVIDENCE provided for the current question."
)


@dataclass
class ContextWindow:
    """What `build_context` produced, and what it had to leave out."""

    session_id: str
    summary: str | None
    messages: list[dict[str, Any]] = field(default_factory=list)
    dropped: int = 0
    estimated_tokens: int = 0
    summary_upto_seq: int = 0

    @property
    def needs_summary(self) -> bool:
        """True when turns fell out of the window and are not yet summarised.

        Layer 7 should schedule a background summarisation pass — *after*
        responding, never on the request path.
        """
        return self.dropped > 0

    @property
    def oldest_kept_seq(self) -> int:
        return self.messages[0]["seq"] if self.messages else self.summary_upto_seq

    def as_prompt_messages(self) -> list[dict[str, str]]:
        """The history portion of a prompt, ready for Ollama.

        Returns only summary + history. The caller prepends the system prompt
        and appends the evidence block and the current question, so the
        evidence is the last thing the model reads before answering.
        """
        out: list[dict[str, str]] = []
        if self.summary:
            out.append(
                {
                    "role": "system",
                    "content": f"Summary of earlier conversation:\n{self.summary}",
                }
            )
        if self.messages:
            out.append({"role": "system", "content": HISTORY_NOTICE})
        for message in self.messages:
            content = message["content"]
            if message["role"] == "assistant":
                content = f"[{_stamp(message['created_at'])}] {content}"
            out.append({"role": message["role"], "content": content})
        return out


def _stamp(created_at: str) -> str:
    """`2026-09-13T10:03:21+00:00` → `2026-09-13 10:03 UTC`.

    The full date, not just the clock time: a session reopened the next day
    would otherwise make yesterday's reading look like it was minutes ago.
    """
    try:
        date, _, rest = created_at.partition("T")
        return f"{date} {rest[:5]} UTC"
    except (AttributeError, ValueError):  # pragma: no cover - defensive
        return created_at


# ── session lifecycle ────────────────────────────────────────────────────────


def create_session(
    *, title: str | None = None, device_id: str = "co2_reactor", ephemeral: bool = False
) -> dict[str, Any]:
    return chat_store.create_session(
        title=title, device_id=device_id, ephemeral=ephemeral
    )


def get_session(session_id: str) -> dict[str, Any]:
    session = chat_store.get_session(session_id)
    if session is None:
        raise chat_store.SessionNotFoundError(session_id)
    return session


def list_sessions(
    *, limit: int = 50, offset: int = 0, include_archived: bool = False
) -> list[dict[str, Any]]:
    return chat_store.list_sessions(
        limit=limit, offset=offset, include_archived=include_archived
    )


def update_session(session_id: str, **changes: Any) -> dict[str, Any]:
    return chat_store.update_session(session_id, **changes)


def delete_session(session_id: str) -> bool:
    return chat_store.delete_session(session_id)


def add_user_message(session_id: str, content: str) -> dict[str, Any]:
    """Record what the user asked. Safe to expose over HTTP."""
    return chat_store.append_message(session_id, "user", content)


def add_assistant_message(
    session_id: str,
    content: str,
    *,
    query_id: str | None = None,
    evidence: Any = None,
    model_tag: str | None = None,
) -> dict[str, Any]:
    """Record what the assistant answered — **orchestrator only**.

    Never reachable from the HTTP API. A client that could write assistant
    messages could seed the model's own context with fabricated readings.
    """
    return chat_store.append_message(
        session_id, "assistant", content, query_id=query_id, evidence=evidence, model_tag=model_tag
    )


def get_messages(session_id: str, *, limit: int | None = None) -> list[dict[str, Any]]:
    get_session(session_id)  # 404 for an unknown session, rather than empty list
    return chat_store.get_messages(session_id, limit=limit)


def purge_ephemeral() -> int:
    """Sweep incognito sessions. Called at startup and shutdown."""
    return chat_store.purge_ephemeral()


# ── context assembly ─────────────────────────────────────────────────────────


def build_context(
    session_id: str,
    *,
    token_budget: int = DEFAULT_HISTORY_TOKEN_BUDGET,
) -> ContextWindow:
    """Assemble the conversation history that fits in `token_budget`.

    Newest-first accumulation: the most recent turns matter most, so they are
    kept and the oldest are dropped into the summariser's lap. A window that
    would begin with an assistant message is trimmed to start at the user turn
    that prompted it — half an exchange reads as a non-sequitur to a small
    model.
    """
    session = get_session(session_id)
    history = chat_store.get_messages(
        session_id, after_seq=session["summary_upto_seq"]
    )

    kept: list[dict[str, Any]] = []
    used = 0
    dropped = 0
    for message in reversed(history):
        cost = message["token_estimate"]
        # Always keep at least one message, even if a single turn is somehow
        # larger than the whole budget — an empty window loses the thread
        # entirely, which is worse than a slightly oversized prompt.
        if kept and used + cost > token_budget:
            dropped = len(history) - len(kept)
            break
        kept.append(message)
        used += cost

    kept.reverse()

    # Never trim down to nothing: a lone assistant turn still carries the
    # referent the next question depends on ("is that still high?"), and an
    # empty window loses the thread completely.
    if len(kept) > 1 and kept[0]["role"] == "assistant":
        used -= kept[0]["token_estimate"]
        kept = kept[1:]
        dropped += 1

    return ContextWindow(
        session_id=session_id,
        summary=session["summary"],
        messages=kept,
        dropped=dropped,
        estimated_tokens=used,
        summary_upto_seq=session["summary_upto_seq"],
    )


def record_summary(session_id: str, summary: str, upto_seq: int) -> None:
    """Persist a rolling summary produced by the background summariser."""
    chat_store.set_summary(session_id, summary, upto_seq)
