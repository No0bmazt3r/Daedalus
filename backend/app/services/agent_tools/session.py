"""Session tools — what was said before, and why that is not evidence.

Odysseus' session tools let an agent create sessions, message them and manage
them. Three of the four are refused here (`registry.EXCLUDED`): a session in
Daedalus is an operator's record of what they were told, and a model writing
into one would be forging that record. What remains is reading, and reading is
where the interesting constraint is.

## Everything in this module is `citable: False`

§7.4 names the hazard precisely. Turn 3 said *"CO₂ is 470.2 ppm."* At turn 9
that number is sitting in the context window: never fetched by this turn, true
twenty minutes ago, and perfectly quotable. Replaying it is exactly what the
<10% hallucination target measures.

The defence at the tool boundary is to mark the result as what it is. Past turns
are `TRANSCRIPT` integrity and never citable, so a number that appears only here
can never become an answer's source — the orchestrator has the flag, and the
groundedness check has a rule it can apply mechanically instead of a convention
it has to remember.

What these tools are *for* is the other half of the same problem: knowing that
an operator already asked about the CO₂ spike an hour ago is genuinely useful
for shaping a reply, as long as the numbers are re-fetched rather than reused.
Every timestamp comes back with the row for that reason.
"""

from __future__ import annotations

from typing import Any

from ...db import chat_store
from .registry import Effect, Integrity, Param, register

_MAX_RESULTS = 20


@register(
    name="list_sessions",
    category="session",
    summary=(
        "List recent conversations — when each happened, its title and how many turns "
        "it has. Context only: values quoted inside a past conversation are stale."
    ),
    effects={Effect.READ_TRANSCRIPT},
    integrity=Integrity.TRANSCRIPT,
    citable=False,
    params=(
        Param("limit", int, "How many conversations to list.",
              default=10, minimum=1, maximum=_MAX_RESULTS),
    ),
)
def list_sessions(limit: int) -> dict[str, Any]:
    """Recent conversations, newest first.

    Incognito sessions stay excluded — `chat_store.list_sessions` hides ephemeral
    rows by default, and this deliberately does not override that. A session
    opened in incognito exists so in-session memory works, and surfacing it to a
    tool would defeat the one thing the mode promises.
    """
    sessions = chat_store.list_sessions(limit=limit)
    return {
        "data": {
            "sessions": [
                {
                    "session_id": s["session_id"],
                    "title": s.get("title"),
                    "created_at": s.get("created_at"),
                    "updated_at": s.get("updated_at"),
                    "message_count": s.get("message_count"),
                }
                for s in sessions
            ]
        },
        "detail": f"{len(sessions)} conversations" if sessions else "no conversations yet",
    }


@register(
    name="search_chats",
    category="session",
    summary=(
        "Find past conversation turns mentioning a phrase. Returns them with their "
        "timestamps. Any value inside is historical and must be re-fetched before use."
    ),
    effects={Effect.READ_TRANSCRIPT},
    integrity=Integrity.TRANSCRIPT,
    citable=False,
    params=(
        Param("query", str, "The phrase to look for.", required=True, max_length=200),
        Param("limit", int, "How many turns to return.",
              default=5, minimum=1, maximum=_MAX_RESULTS),
    ),
)
def search_chats(query: str, limit: int) -> dict[str, Any]:
    """Substring search over stored turns.

    A LIKE scan rather than an index, because the transcript store is small and
    the alternative — embedding the conversation — would put a second vector
    space next to Track 1's and make "which index answered" ambiguous for no
    gain at this size.
    """
    from ...db import sqlite_util  # noqa: PLC0415 — keeps the store's driver in one place

    chat_store.init_db()
    pattern = f"%{query}%"
    with sqlite_util.connect(chat_store.DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT m.session_id, m.role, m.content, m.created_at, s.title
              FROM chat_messages m
              JOIN chat_sessions s ON s.session_id = m.session_id
             WHERE m.content LIKE ? AND s.ephemeral = 0
             ORDER BY m.created_at DESC
             LIMIT ?
            """,
            (pattern, limit),
        ).fetchall()

    turns = [
        {
            "session_id": r["session_id"],
            "session_title": r["title"],
            "role": r["role"],
            # Trimmed: a whole turn in a tool result competes with the evidence
            # pack for a context window this project budgets at 4096.
            "excerpt": (r["content"] or "")[:400],
            "said_at": r["created_at"],
        }
        for r in rows
    ]
    return {
        "data": {"turns": turns},
        "detail": (
            f"{len(turns)} past turns mention that — historical, not evidence"
            if turns else f"nothing in past conversations mentions {query!r}"
        ),
    }


@register(
    name="get_session_summary",
    category="session",
    summary=(
        "The rolling summary of one conversation — what it has been about, without "
        "replaying every turn."
    ),
    effects={Effect.READ_TRANSCRIPT},
    integrity=Integrity.TRANSCRIPT,
    citable=False,
    params=(
        Param("session_id", str, "Which conversation.", required=True, max_length=100),
    ),
)
def get_session_summary(session_id: str) -> dict[str, Any]:
    """The summary §7.4 already maintains, read rather than regenerated.

    Cheaper than reading the turns and safer than guessing: the summary is
    natural-language text by construction, so it carries no numbers that were
    never re-fetched.
    """
    session = chat_store.get_session(session_id)
    if session is None:
        return {"data": None, "detail": f"no conversation with id {session_id!r}"}
    return {
        "data": {
            "session_id": session["session_id"],
            "title": session.get("title"),
            "summary": session.get("summary"),
            "updated_at": session.get("updated_at"),
        },
        "detail": "summary" if session.get("summary") else "this conversation has no summary yet",
    }
