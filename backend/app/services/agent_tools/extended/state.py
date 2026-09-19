"""Tools that change stored state — sessions, and configuration.

Two `WRITE` tools and two `ADMIN` tools, each the counterpart of something
`registry.EXCLUDED` names.

## Sessions: written, but never anonymously

Odysseus lets an agent open a session and post into it. The objection recorded in
`EXCLUDED` stands — a session is an operator's record of what they were told, and
a model writing into one silently would be forging that record. So these tools
write, and every row they write is stamped: the session is titled as
agent-created and messages carry `authored_by_tool`. The record stays honest
because the writes are labelled, not because nobody can make them.

## Configuration: a whitelist, and never a secret

`manage_settings` is not a general setter. It can change four things, all of
which a person could change in a panel and none of which can lock anybody out.
Deliberately absent:

- **Anything holding a credential.** `model_endpoints` and `search_providers` are
  not reachable from here, in either direction. A tool that could read a key
  would put it in a model's context window, and a model's context window ends up
  in a log, a screenshot and a report.
- **The embedding model.** Changing it invalidates Track 1's whole index
  (`embedding_models`' one-way door), and a re-ingest is not something to
  discover afterwards in a `tool_logs` row.
- **The active retrieval track**, while the comparison is frozen. §5's whole
  result depends on nobody moving that during a run — `rag_config.write` already
  refuses it, and this does not offer a second route.
"""

from __future__ import annotations

from typing import Any

from ....db import chat_store
from ... import model_endpoints, rag_config
from ..registry import Effect, Integrity, Param, ToolError, register

# Each entry is a setting a model may change, and the function that changes it.
# A whitelist rather than a dispatch on a string, so "what can this tool do" is
# answered by reading eight lines rather than by auditing a module.
_SETTABLE = ("rag_track",)


@register(
    name="create_session",
    category="session",
    summary=(
        "Open a new conversation, for example to work a diagnostic separately from the "
        "current one. It is labelled as agent-created."
    ),
    effects={Effect.WRITE},
    params=(
        Param("title", str, "What the new conversation is about.", required=True, max_length=120),
    ),
)
def create_session(title: str) -> dict[str, Any]:
    session = chat_store.create_session(title=f"{title} (agent)")
    return {
        "data": {"session_id": session["session_id"], "title": session.get("title")},
        "detail": f"opened {session['session_id']}",
    }


@register(
    name="send_to_session",
    category="session",
    summary=(
        "Post a message into a conversation. It is stored marked as written by a tool, "
        "not by the operator."
    ),
    effects={Effect.WRITE},
    integrity=Integrity.TRANSCRIPT,
    citable=False,
    params=(
        Param("session_id", str, "Which conversation.", required=True, max_length=100),
        Param("content", str, "What to write.", required=True, max_length=4000),
    ),
)
def send_to_session(session_id: str, content: str) -> dict[str, Any]:
    """Append one message, attributed.

    `role='assistant'` with a marker rather than `role='user'`: a tool writing as
    the user would make the transcript claim a person said something they did
    not, and the transcript is the only record of what an operator was actually
    told.
    """
    if chat_store.get_session(session_id) is None:
        raise ToolError(f"no conversation with id {session_id!r}")
    message = chat_store.append_message(
        session_id=session_id,
        role="assistant",
        content=f"[written by the send_to_session tool]\n\n{content}",
    )
    return {
        "data": {"session_id": session_id, "message_id": message.get("id")},
        "detail": f"posted to {session_id}",
    }


@register(
    name="manage_settings",
    category="system",
    summary=(
        "Read or change a small whitelist of settings. Cannot touch credentials, the "
        "embedding model, or the retrieval track while the comparison is frozen."
    ),
    effects={Effect.ADMIN},
    params=(
        Param("action", str, "What to do.", required=True, enum=("get", "set")),
        Param("setting", str, "Which setting.", required=True, enum=_SETTABLE),
        Param("value", str, "The new value, for `set`.", default=None, max_length=100),
    ),
)
def manage_settings(action: str, setting: str, value: str | None) -> dict[str, Any]:
    if setting != "rag_track":  # pragma: no cover — the enum already constrains it
        raise ToolError(f"{setting!r} is not settable from a tool")

    if action == "get":
        status = rag_config.status()
        return {
            "data": {"setting": setting, "value": status["track"], "frozen": status.get("frozen")},
            "detail": f"rag_track is {status['track']}",
        }

    if not value:
        raise ToolError("set needs a value")
    try:
        updated = rag_config.write(value, note="changed by the manage_settings tool")
    except Exception as exc:  # noqa: BLE001 — rag_config owns the refusal and its wording
        raise ToolError(str(exc)) from exc
    return {
        "data": {"setting": setting, "value": updated["track"]},
        "detail": f"rag_track is now {updated['track']}",
    }


@register(
    name="manage_endpoints",
    category="system",
    summary=(
        "List, add, enable/disable or remove a cloud benchmark endpoint. Keys are "
        "write-only: they go in and never come back out."
    ),
    effects={Effect.ADMIN},
    params=(
        Param("action", str, "What to do.", required=True,
              enum=("list", "add", "update", "delete")),
        Param("provider", str, "Which provider, for `add`.", default=None, max_length=60),
        Param("base_url", str, "Its API base URL, for `add`.", default=None, max_length=500),
        Param("api_key", str, "The credential, for `add`. Never returned.",
              default=None, max_length=400),
        Param("label", str, "What to call it.", default=None, max_length=120),
        Param("endpoint_id", str, "Which endpoint, for `update` and `delete`.",
              default=None, max_length=100),
        Param("enabled", bool, "Enable or disable it, for `update`.", default=None),
    ),
)
def manage_endpoints(
    action: str,
    provider: str | None,
    base_url: str | None,
    api_key: str | None,
    label: str | None,
    endpoint_id: str | None,
    enabled: bool | None,
) -> dict[str, Any]:
    """The whole lifecycle, with one asymmetry that is not negotiable.

    A key can be **written** and never **read**. `model_endpoints.list_endpoints`
    returns `key_hint` and `has_key`, never the credential, and there is no
    action here that returns one — because a tool result ends up in a model's
    context window, and a context window ends up in a log, a screenshot and a
    report.

    `purpose` is not a parameter. The column's CHECK admits only `'benchmark'`,
    so a row claiming runtime use cannot be written from here or from anywhere
    else — Rule 1 holds in the schema rather than in this function.
    """
    if action == "list":
        rows = model_endpoints.list_endpoints()
        return {
            "data": {
                "endpoints": [
                    {
                        "id": row["id"],
                        "label": row["label"],
                        "provider": row["provider"],
                        "base_url": row["base_url"],
                        "enabled": row["enabled"],
                        "has_key": row["has_key"],
                        "key_hint": row["key_hint"],
                        "purpose": row["purpose"],
                        "last_test_ok": row["last_test_ok"],
                    }
                    for row in rows
                ]
            },
            "detail": f"{len(rows)} benchmark endpoints configured"
                      if rows else "no benchmark endpoints configured",
        }

    if action == "add":
        if not provider or not base_url:
            raise ToolError("add needs a provider and a base_url")
        if not model_endpoints.is_known_provider(provider):
            known = ", ".join(p["id"] for p in model_endpoints.providers())
            raise ToolError(f"unknown provider {provider!r}; expected one of {known}")
        try:
            created = model_endpoints.create_endpoint(
                provider=provider, base_url=base_url, api_key=api_key, label=label
            )
        except Exception as exc:  # noqa: BLE001 — the store owns the wording of its refusals
            raise ToolError(str(exc)) from exc
        return {
            "data": {"id": created["id"], "provider": created["provider"],
                     "has_key": created["has_key"]},
            "detail": f"added {created['label']}",
        }

    if action == "update":
        if not endpoint_id:
            raise ToolError("update needs an endpoint_id")
        changes: dict[str, Any] = {}
        if enabled is not None:
            changes["enabled"] = enabled
        if label:
            changes["label"] = label
        if api_key:
            changes["api_key"] = api_key
        if not changes:
            raise ToolError("update needs something to change: enabled, label or api_key")
        try:
            updated = model_endpoints.update_endpoint(endpoint_id, **changes)
        except Exception as exc:  # noqa: BLE001
            raise ToolError(str(exc)) from exc
        return {
            "data": {"id": updated["id"], "enabled": updated["enabled"],
                     "has_key": updated["has_key"]},
            "detail": f"updated {updated['label']}",
        }

    if not endpoint_id:
        raise ToolError("delete needs an endpoint_id")
    removed = model_endpoints.delete_endpoint(endpoint_id)
    return {
        "data": {"id": endpoint_id, "deleted": removed},
        "detail": f"deleted {endpoint_id}" if removed else f"no endpoint with id {endpoint_id!r}",
    }
