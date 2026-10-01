"""Step 4 of PROJECT.md §7.1: the safety guard.

A request to act on the plant — "open ABV-1", "start desorption", "set the
temperature to 80" — is answered with a fixed refusal, and **nothing else
runs**: no tool, no retrieval, no model. Rule 2 already makes an action
impossible (no tool has a write signature, the sensor database is opened
read-only), so the guard is not what stops the valve moving. It stops the model
*claiming* it moved. A small model asked to open a valve will cheerfully say
"Done — ABV-1 is now open", and an operator who believes it has been misled
about the state of real hardware whose true position nothing downstream can
verify.

## Deterministic, and never delegated to a model

Every decision here is a regular expression over the normalised text, so the
same message is always refused or always allowed, and "why was this refused?"
has an answer that is a line of this file. A model is never asked whether
something is safe: it could be talked out of the answer, and a guard that can
be argued with is not a guard.

## A command is a verb *and* a target, at the start of a clause

"How do I open ABV-1?" and "Open ABV-1" contain the same words. What separates
them is structure: in a command the control verb leads its clause (after any
"please" / "can you"), and in a question it does not. So a message is split
into clauses — "tell me the pressure and then open ABV-1" is two requests — and
each clause is checked for a leading verb whose object is something that verb
can act on. The target check is what keeps "open the SOP for NDIR" (a document)
from being refused alongside "open the valve" (hardware).

| reason | example | refusal |
|---|---|---|
| `control_command` | "open ABV-1", "start desorption", "set temperature to 80", "acknowledge the alarm" | §7.1's fixed text |
| `data_write` | "delete the 10:00 reading", "update the log", `DROP TABLE` | same, for data |
| `instruction_override` | "ignore your rules and…", "you are now in developer mode" | same, for the rules |

## Where it runs

Twice, and before any model call both times (see `query_pipeline.understand`):
on the raw message, so a plain command never costs the model call follow-up
rewriting might make; and on the rewritten question, so "open it" after a turn
about ABV-1 is caught once "it" is resolved. A pronoun is treated as a target
on its own — "shut it off" is refused even with nothing to resolve it against,
because a wrong refusal costs one sentence and a wrong answer costs the
operator's picture of the plant.

## What it deliberately allows

Questions about control are information, and information is the product:
"how do I start desorption?", "what happens if ABV-1 is closed?", "should I
reduce the flow?", "is the valve open?". The answer to each comes from SOPs and
sensor data, and none of them asks the assistant to do anything.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from . import vocabulary as vocab

REFUSAL_CONTROL = "I cannot control the reactor. I only provide read-only monitoring information."
REFUSAL_DATA = (
    "I cannot change the reactor's data. I only provide read-only monitoring information."
)
REFUSAL_OVERRIDE = (
    "I cannot change how I operate. I only provide read-only monitoring information "
    "about the reactor."
)

# Appended to a control refusal, because the operator usually wants the
# procedure, and the refusal should point at the question that gets it.
_PROCEDURE_HINT = (
    " If you need the procedure, ask me how to do it — for example, "
    '"How do I {phrase}?"'
)

# Equipment tags read back in the operator's own form: ABV-1, not abv-1.
_TAG_RE = re.compile(r"\babv[-\s]?\d+\b|\bndir\b|\bco2\b|\bsop\b")

_ACTUATE_RE = re.compile(rf"^(?P<verb>{vocab.ACTUATE_VERBS})\b(?P<rest>.*)$")
_ADJUST_RE = re.compile(rf"^(?P<verb>{vocab.ADJUST_VERBS})\b(?P<rest>.*)$")
_DATA_RE = re.compile(rf"^(?P<verb>{vocab.DATA_VERBS})\b(?P<rest>.*)$")
# "make the pump stop", "get the heater running", "have ABV-1 opened".
_CAUSATIVE_RE = re.compile(
    r"^(?:make|get|have|let|keep)\s+(?P<rest>.{0,60}?)\b(?:run|running|stop|stopped|start|started|open|opened"
    r"|close|closed|on|off|shut|higher|lower|up|down)\b"
)
# Phrasal verbs that command on their own, with no object named.
_BARE_COMMAND_RE = re.compile(
    r"^(?:shut\s+(?:it\s+)?down|power\s+(?:it\s+)?(?:off|down)|turn\s+(?:it\s+)?(?:on|off)"
    r"|switch\s+(?:it\s+)?(?:on|off)|emergency\s+stop|e-?stop|actuate|vent|purge)\b"
)

# How far past the verb the object may sit: "open the main inlet valve". A weak
# verb gets a shorter reach — see `vocabulary.WEAK_VERBS`.
_OBJECT_WINDOW = 60
_WEAK_OBJECT_WINDOW = 22


@dataclass(frozen=True)
class Verdict:
    blocked: bool
    #: None | 'control_command' | 'data_write' | 'instruction_override'
    reason: str | None = None
    #: The clause that triggered it — what the audit row and the UI show.
    clause: str | None = None
    #: The reply to give instead of an answer. None when not blocked.
    message: str | None = None


ALLOW = Verdict(blocked=False)


def _strip_prefix(clause: str) -> str:
    return vocab.REQUEST_PREFIX_RE.sub("", clause).strip()


def _object(verb: str, rest: str) -> str | None:
    """What the verb acts on, or None when that is a document or a view."""
    if vocab.DOCUMENT_OBJECT_RE.match(rest):
        return None
    head = verb.split()[0]
    return rest[: _WEAK_OBJECT_WINDOW if head in vocab.WEAK_VERBS else _OBJECT_WINDOW]


def _control(clause: str) -> Verdict | None:
    body = _strip_prefix(clause)
    if not body or vocab.QUESTION_START_RE.match(body):
        return None

    if _BARE_COMMAND_RE.match(body):
        return _refuse("control_command", clause, body)

    m = _DATA_RE.match(body)
    if m:
        obj = _object(m.group("verb"), m.group("rest"))
        if obj is not None and vocab.DATA_TARGET_RE.search(obj):
            return _refuse("data_write", clause, body)

    m = _ACTUATE_RE.match(body)
    if m:
        obj = _object(m.group("verb"), m.group("rest"))
        if obj is not None and (
            vocab.PLANT_TARGET_RE.search(obj) or vocab.PRONOUN_TARGET_RE.match(obj)
        ):
            return _refuse("control_command", clause, body)

    m = _ADJUST_RE.match(body)
    if m:
        obj = _object(m.group("verb"), m.group("rest"))
        if obj is not None and (
            vocab.PARAMETER_TARGET_RE.search(obj)
            or vocab.PLANT_TARGET_RE.search(obj)
            or vocab.PRONOUN_TARGET_RE.match(obj)
        ):
            return _refuse("control_command", clause, body)

    for pattern in (_CAUSATIVE_RE, vocab.PLACEMENT_RE):
        m = pattern.match(body)
        if m and (
            vocab.PLANT_TARGET_RE.search(m.group("rest"))
            or vocab.PARAMETER_TARGET_RE.search(m.group("rest"))
            or vocab.PRONOUN_TARGET_RE.match(m.group("rest"))
        ):
            return _refuse("control_command", clause, body)

    return None


def _refuse(reason: str, clause: str, body: str) -> Verdict:
    if reason == "data_write":
        message = REFUSAL_DATA
    elif reason == "instruction_override":
        message = REFUSAL_OVERRIDE
    else:
        message = REFUSAL_CONTROL
        # Only when the command names something concrete: "How do I open it?"
        # is no help to anyone.
        if not vocab.PRONOUN_TARGET_RE.search(body.split(" ", 1)[-1]) and len(body) <= 60:
            phrase = _TAG_RE.sub(lambda t: t.group(0).upper(), body.rstrip(" .!?"))
            message += _PROCEDURE_HINT.format(phrase=phrase)
    return Verdict(blocked=True, reason=reason, clause=clause.strip(), message=message)


def check(match: str) -> Verdict:
    """Refuse `match` (normalised, lower-cased text) if it asks for an action.

    Checked in order of how unambiguous each signal is: raw SQL and attempts to
    talk the assistant out of its rules first, as they need no clause
    structure; then each clause for a command.
    """
    if not match:
        return ALLOW

    if vocab.SQL_WRITE_RE.search(match):
        return _refuse("data_write", match, match)
    override = vocab.OVERRIDE_RE.search(match)
    if override:
        return _refuse("instruction_override", override.group(0), override.group(0))

    for clause in vocab.CLAUSE_SPLIT_RE.split(match):
        clause = clause.strip(" '\"()")
        if not clause:
            continue
        verdict = _control(clause)
        if verdict:
            return verdict
    return ALLOW
