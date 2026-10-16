"""The user persona — Daedalus learning how this install's user works.

A background job reads the user's own messages and proposes what it noticed:
how they like answers written, the shorthand they use for equipment, the topics
they keep coming back to, and what kind of user they seem to be. **Nothing it
proposes changes behaviour until the user accepts it** in Settings → Persona —
the same "model proposes, a person disposes" rule as `graph_proposals`, for
the same reason: every change to how the assistant behaves has to be one
somebody can point at and explain.

## What it may learn, and why each kind is closed

| kind | key | value | grounded by |
|---|---|---|---|
| `style` | `language` · `length` · `format` · `technical_level` | a fixed list each (`STYLE`) | the list |
| `role` | `role` | operator · student · researcher · engineer · supervisor | the list |
| `vocabulary` | the user's own term, which must appear in a message they wrote | a knowledge-graph node | `graph_query_natural` |
| `focus` | `topic` | a knowledge-graph node | `graph_query_natural` |

A small local model is good at noticing and bad at naming, so it only picks
from vocabularies this module owns: a style value outside the list, a "term"
the user never typed, or a topic that resolves to no node is dropped before it
is queued. Every proposal also has to cite the messages that showed it. The
statement shown in Settings is written here from the fields, never by the model.

## How an accepted trait is used — and what it can never do

- `style`, `role`, `focus` and `vocabulary` become a short system message,
  marked as *not evidence*: it shapes how an answer is written, never what is
  true. Rule 3 (numbers from tools) and Rule 4 (procedures from retrieval) do
  not bend for it.
- `vocabulary` also expands the question before retrieval: "check the column"
  becomes "check the column (Absorber …)", so the user's shorthand reaches the
  documents. The expansion is in `standalone_query`, so the log shows it.

## When it does not run

Never in incognito, never on an evaluation turn (a persona that drifts would
make "freeze, then run once" meaningless — `inference` passes `evaluation`),
and not at all while switched off in Settings. Off also stops it being *used*.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import threading
from typing import Any

from ..db import chat_store, prefs_store, sqlite_util
from ..db.paths import CHAT_DB
from ..db.sqlite_util import utc_now as _now
from . import background_models, graph_tools, live_events
from .query_pipeline import local_model

log = logging.getLogger("daedalus.persona")

KINDS = ("style", "vocabulary", "focus", "role")
STYLE: dict[str, tuple[str, ...]] = {
    "language": ("en", "ms"),
    "length": ("brief", "detailed"),
    "format": ("steps", "prose", "table"),
    "technical_level": ("plain", "technical"),
}
ROLES = ("operator", "student", "researcher", "engineer", "supervisor")
# Single-valued: accepting "brief" retires an accepted "detailed".
_EXCLUSIVE = ("style", "role")

# Scan once this many new user messages have built up in a chat.
SCAN_EVERY = 3
_MESSAGES_SHOWN = 12
_MESSAGE_CHARS = 300
TIMEOUT_S = 60.0
PREF_KEY = "persona"

_SYSTEM = (
    "You study how ONE user talks to a read-only assistant for a CO2 sorption reactor, from their "
    "own numbered messages, and report stable habits only — never a one-off. Kinds:\n"
    '- style: key one of "language" (en|ms), "length" (brief|detailed), "format" (steps|prose|table), '
    '"technical_level" (plain|technical)\n'
    '- role: key "role", value one of operator|student|researcher|engineer|supervisor\n'
    '- vocabulary: key = a shorthand the user literally wrote (e.g. "the column"), value = the '
    "equipment, sensor or procedure it means\n"
    '- focus: key "topic", value = a sensor, equipment, fault or procedure they keep asking about\n'
    'Reply with JSON {"traits": [{"kind": "...", "key": "...", "value": "...", "messages": [1, 3]}]} '
    'where messages are the numbers that show it. Reply {"traits": []} if nothing is clear.'
)

_running = threading.Lock()


# ── settings ─────────────────────────────────────────────────────────────────


def enabled() -> bool:
    try:
        return bool((prefs_store.get_pref(PREF_KEY) or {}).get("enabled", True))
    except Exception:  # noqa: BLE001 — an unreadable pref must not break the chat path
        return False


def set_enabled(value: bool) -> None:
    prefs_store.set_pref(PREF_KEY, {"enabled": bool(value)})


# ── store ────────────────────────────────────────────────────────────────────


def _row(r: Any) -> dict[str, Any]:
    out = dict(r)
    out["evidence"] = json.loads(out.get("evidence") or "[]")
    out["statement"] = statement(out)
    return out


def traits(status: str | None = None) -> list[dict[str, Any]]:
    chat_store.init_db()
    sql, args = "SELECT * FROM persona_traits", []
    if status:
        sql, args = sql + " WHERE status = ?", [status]
    with sqlite_util.connect(CHAT_DB) as conn:
        rows = conn.execute(sql + " ORDER BY kind, key, sightings DESC", args).fetchall()
    return [_row(r) for r in rows]


def statement(t: dict[str, Any]) -> str:
    """What Settings shows, written from the fields — never by the model."""
    kind, key, value = t["kind"], t["key"], t["value"]
    if kind == "style":
        return {
            "language": f"Prefers answers in {'Malay' if value == 'ms' else 'English'}",
            "length": f"Prefers {value} answers",
            "format": {"steps": "Prefers step-by-step lists", "prose": "Prefers answers in prose",
                       "table": "Prefers tables where they fit"}.get(value, value),
            "technical_level": ("Prefers plain, non-technical wording" if value == "plain"
                                else "Is comfortable with technical detail"),
        }.get(key, f"{key}: {value}")
    if kind == "role":
        return f"Seems to be {'an' if value[0] in 'aeiou' else 'a'} {value}"
    if kind == "vocabulary":
        return f'Says "{key}" to mean {value}'
    return f"Often asks about {value}"


def _upsert(kind: str, key: str, value: str, node_id: str | None, evidence: list[dict[str, Any]]) -> str | None:
    """Queue a proposal, or reinforce the matching row. Returns what happened."""
    now = _now()
    with sqlite_util.transaction(CHAT_DB) as conn:
        existing = conn.execute(
            "SELECT trait_id, status, evidence FROM persona_traits WHERE kind = ? AND key = ? AND value = ?",
            (kind, key, value),
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO persona_traits (trait_id, kind, key, value, node_id, evidence, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (f"pt_{secrets.token_hex(6)}", kind, key, value, node_id, json.dumps(evidence), now, now),
            )
            return "proposed"
        if existing["status"] == "rejected":
            return None  # the user said no; seeing it again is not a reason to ask again
        merged = json.loads(existing["evidence"] or "[]")
        merged += [e for e in evidence if e not in merged]
        conn.execute(
            "UPDATE persona_traits SET sightings = sightings + 1, evidence = ?, updated_at = ? WHERE trait_id = ?",
            (json.dumps(merged[-20:]), now, existing["trait_id"]),
        )
        return "reinforced"


def decide(trait_id: str, accept: bool) -> dict[str, Any] | None:
    chat_store.init_db()
    now = _now()
    with sqlite_util.transaction(CHAT_DB) as conn:
        row = conn.execute("SELECT * FROM persona_traits WHERE trait_id = ?", (trait_id,)).fetchone()
        if row is None:
            return None
        if accept and row["kind"] in _EXCLUSIVE:
            # One answer length, one role: the new one replaces the old.
            conn.execute(
                "UPDATE persona_traits SET status = 'rejected', decided_at = ? "
                "WHERE kind = ? AND key = ? AND status = 'accepted' AND trait_id != ?",
                (now, row["kind"], row["key"], trait_id),
            )
        conn.execute(
            "UPDATE persona_traits SET status = ?, decided_at = ?, updated_at = ? WHERE trait_id = ?",
            ("accepted" if accept else "rejected", now, now, trait_id),
        )
    live_events.publish("persona")
    return next((t for t in traits() if t["trait_id"] == trait_id), None)


def forget(trait_id: str | None = None) -> int:
    """Delete one trait, or — with no id — everything learned, scan marks included."""
    chat_store.init_db()
    with sqlite_util.transaction(CHAT_DB) as conn:
        if trait_id:
            n = conn.execute("DELETE FROM persona_traits WHERE trait_id = ?", (trait_id,)).rowcount
        else:
            n = conn.execute("DELETE FROM persona_traits").rowcount
            conn.execute("DELETE FROM persona_scans")
    live_events.publish("persona")
    return n


def evidence_text(evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The user messages a trait cites, read now — a deleted chat shows as gone."""
    out = []
    with sqlite_util.connect(CHAT_DB) as conn:
        for e in evidence:
            r = conn.execute(
                "SELECT content, created_at FROM chat_messages WHERE session_id = ? AND seq = ? AND role = 'user'",
                (e.get("session_id"), e.get("seq")),
            ).fetchone()
            out.append({**e, "text": r["content"] if r else None, "at": r["created_at"] if r else None})
    return out


# ── the scan ─────────────────────────────────────────────────────────────────


def schedule(session_id: str) -> bool:
    """After a stored answer: scan this chat in the background if it is due."""
    if not enabled():
        return False

    def _run() -> None:
        if not _running.acquire(blocking=False):
            return  # one scan at a time; the next answer will pick this chat up
        try:
            if scan(session_id):
                live_events.publish("persona")
        except Exception as exc:  # noqa: BLE001 — a background job must never surface
            log.warning("persona scan of %s failed: %s", session_id, exc)
        finally:
            _running.release()

    threading.Thread(target=_run, name=f"persona-{session_id[:8]}", daemon=True).start()
    return True


def scan(session_id: str, *, force: bool = False, ask: Any = None) -> list[dict[str, Any]]:
    """Read this chat's new user messages and queue what they show. Returns what was queued.

    `ask` replaces the model call in tests: `ask(system, prompt) -> dict | None`.
    """
    session = chat_store.get_session(session_id)
    if session is None or session.get("ephemeral"):
        return []
    with sqlite_util.connect(CHAT_DB) as conn:
        mark = conn.execute("SELECT upto_seq FROM persona_scans WHERE session_id = ?", (session_id,)).fetchone()
    upto = mark["upto_seq"] if mark else 0
    mine = [m for m in chat_store.get_messages(session_id, after_seq=upto) if m["role"] == "user"]
    if not mine or (len(mine) < SCAN_EVERY and not force):
        return []
    shown = mine[-_MESSAGES_SHOWN:]

    known = "; ".join(f"{t['kind']} {t['key']}={t['value']}" for t in traits() if t["status"] != "rejected")
    prompt = "\n".join(f"{i}. {' '.join(str(m['content']).split())[:_MESSAGE_CHARS]}"
                       for i, m in enumerate(shown, 1))
    if known:
        prompt = f"Already known (report again only if these messages show it too): {known}\n\n" + prompt
    if ask is None:
        data, _tag = local_model.ask_json(_SYSTEM, prompt, max_tokens=300, timeout=TIMEOUT_S,
                                          tag=background_models.configured_tag("summary"))
    else:
        data = ask(_SYSTEM, prompt)

    queued = []
    for raw in (data or {}).get("traits") or []:
        trait = validate(raw, shown, session_id)
        if trait and _upsert(**trait) == "proposed":
            queued.append(trait)

    with sqlite_util.transaction(CHAT_DB) as conn:
        conn.execute(
            "INSERT INTO persona_scans (session_id, upto_seq, scanned_at) VALUES (?,?,?) "
            "ON CONFLICT(session_id) DO UPDATE SET upto_seq = excluded.upto_seq, scanned_at = excluded.scanned_at",
            (session_id, mine[-1]["seq"], _now()),
        )
    return queued


def validate(raw: Any, shown: list[dict[str, Any]], session_id: str) -> dict[str, Any] | None:
    """One model proposal, checked against the closed vocabularies. None when it fails any."""
    if not isinstance(raw, dict):
        return None
    kind = str(raw.get("kind") or "").strip().lower()
    key = " ".join(str(raw.get("key") or "").split()).lower()[:60]
    value = " ".join(str(raw.get("value") or "").split())[:80]
    picks = raw.get("messages") if isinstance(raw.get("messages"), list) else []
    cited = [shown[i - 1] for i in picks if isinstance(i, int) and 1 <= i <= len(shown)]
    if kind not in KINDS or not key or not value or not cited:
        return None  # a habit nobody can point at is not one
    evidence = [{"session_id": session_id, "seq": m["seq"]} for m in cited]
    node_id = None

    if kind == "style":
        value = value.lower()
        if value not in STYLE.get(key, ()):
            return None
    elif kind == "role":
        value = value.lower()
        if key != "role" or value not in ROLES:
            return None
    else:
        if kind == "vocabulary" and not any(re.search(rf"\b{re.escape(key)}\b", str(m["content"]).lower())
                                            for m in cited):
            return None  # not a word the user actually wrote
        if kind == "focus":
            key = "topic"
        nodes, _strategy = graph_tools.graph_query_natural(value, limit=1)
        if not nodes:
            return None  # nothing in the knowledge graph this could mean
        node_id, value = nodes[0]["id"], nodes[0].get("label") or nodes[0]["id"]
        if kind == "vocabulary" and key == value.lower():
            return None  # "NDIR" means NDIR: nothing learned
    return {"kind": kind, "key": key, "value": value, "node_id": node_id, "evidence": evidence}


# ── use ──────────────────────────────────────────────────────────────────────


def _accepted() -> list[dict[str, Any]]:
    if not enabled():
        return []
    try:
        return traits("accepted")
    except Exception:  # noqa: BLE001 — the persona is a refinement; never the reason a turn fails
        return []


def prompt_block() -> str | None:
    """The system message for accepted traits, or None. Explicitly not evidence."""
    accepted = _accepted()
    if not accepted:
        return None
    lines = "\n".join(f"- {t['statement']}." for t in accepted)
    return (
        "ABOUT THIS USER — learned from their earlier conversations and approved by them. Use it to "
        "choose wording, length, format and how much to explain. It is NOT evidence: never state a "
        "value, limit, step or fact because of it.\n" + lines
    )


def expand(question: str) -> tuple[str, list[str]]:
    """The user's accepted shorthand, spelled out for retrieval. Returns the text and the terms used."""
    used = []
    for t in _accepted():
        if t["kind"] != "vocabulary" or t["value"].lower() in question.lower():
            continue
        m = re.search(rf"\b{re.escape(t['key'])}\b", question, re.IGNORECASE)
        if m:
            question = f"{question[:m.end()]} ({t['value']}){question[m.end():]}"
            used.append(t["key"])
    return question, used


def graph() -> dict[str, Any]:
    """Accepted and proposed traits as a node-link graph for the Settings globe."""
    nodes = [{"id": "you", "type": "You", "label": "You", "degree": 0}]
    edges = []
    for kind in KINDS:
        nodes.append({"id": f"kind:{kind}", "type": "Kind", "label": kind.title(), "degree": 0})
        edges.append({"from": "you", "type": "HAS", "to": f"kind:{kind}"})
    for t in traits():
        if t["status"] == "rejected":
            continue
        nodes.append({"id": t["trait_id"], "type": t["status"].title(), "label": t["statement"],
                      "degree": t["sightings"], "kind": t["kind"]})
        edges.append({"from": f"kind:{t['kind']}", "type": t["status"].upper(), "to": t["trait_id"]})
    for n in nodes:
        n["degree"] = n["degree"] or sum(1 for e in edges if n["id"] in (e["from"], e["to"]))
    return {"nodes": nodes, "edges": edges}
