"""Follow-up condensation — PROJECT.md §7.4, run before intent classification.

"And the pressure?" has no intent and nothing retrievable on its own. Before it
is classified it is rewritten into a question that stands alone — "What is the
current pressure?" — and everything downstream (classification, tool planning,
*both* retrieval tracks) runs on that rewritten form. §7.4 requires the same
rewrite to reach both tracks; producing it once, here, is what guarantees it.

## Two ways to rewrite, cheapest first

| method | when | how |
|---|---|---|
| `rules` | the follow-up swaps a sensor or a time — "and pH?", "what about yesterday?" | the previous standalone question with that slot replaced |
| `model` | anything the rules cannot resolve — "why did it do that?" | the local model, given the last exchange |
| `none` | the message already stands alone, or neither method succeeded | unchanged |

Slot substitution covers the common case with no model call and no chance of
the rewrite adding something the operator did not ask. The model handles
pronouns and ellipsis the rules cannot, and is told to rewrite, not answer.

## Built on the previous *standalone* question

The rewrite starts from the previous turn's rewritten form, not its raw text:
"and pH?" after "and the pressure?" must become "What is the current pH?", which
only works if "and the pressure?" was already stored as "What is the current
pressure?". `chat_messages.standalone_query` holds it.

## It never decides safety

A rewrite can turn "open it" into "open ABV-1". That is why the safety guard
runs again on the rewritten question — and why the raw message is guarded
*before* this runs, so a plain command never reaches the model call here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from . import local_model
from . import vocabulary as vocab
from .normaliser import NormalisedQuery

# Starts that mark a message as continuing the last one.
_CONNECTOR_RE = re.compile(
    r"^(?:and|but|also|plus|so|or|then|now|ok(?:ay)?(?:\s*,)?\s+(?:and|what\s+about)"
    r"|what\s+about|how\s+about|and\s+what\s+about|what\s+of|same\s+(?:thing\s+)?for|same\s+with"
    r"|and\s+for|now\s+for|how\s+(?:about|is)\s+it\s+for|bagaimana\s+dengan|dan)\b"
)
# Words that point back at something said before.
_REFERENT_RE = re.compile(
    r"\b(?:it|its|it's|that|this|those|these|them|they|there|then|the\s+same|same|earlier|previous|above"
    r"|before\s+that|after\s+that)\b"
)
_QUESTION_WORD_RE = re.compile(
    r"\b(?:what|when|why|how|which|who|where|is|are|was|were|do|does|did|can|could|should|show|tell|give|list)\b"
)

# Longest reply history the model is shown. The last answer is context for
# "it", not evidence, and a long one would slow the step for nothing.
_REPLY_CHARS = 600
_MAX_REWRITE_CHARS = 400


@dataclass(frozen=True)
class Rewrite:
    text: str
    #: 'none' | 'rules' | 'model'
    method: str
    #: The previous standalone question it was built from, if any.
    basis: str | None = None
    #: Why no rewrite happened, or what the rules substituted.
    note: str | None = None


def _previous(history: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """(previous standalone user question, the reply to it), newest first."""
    question = reply = None
    for message in reversed(history):
        if message.get("role") == "assistant" and reply is None and question is None:
            reply = message.get("content")
        elif message.get("role") == "user":
            question = message.get("standalone_query") or message.get("content")
            break
    return question, reply


def is_follow_up(nq: NormalisedQuery, previous: str | None) -> bool:
    """Whether this message leans on the one before it to mean anything."""
    if not previous:
        return False
    text = nq.match
    words = re.findall(r"[\w'-]+", text)
    sensors = vocab.find_sensors(text)
    points, windows = vocab.find_time(text)

    if _CONNECTOR_RE.match(text):
        return True
    # "why did it spike?" — a pointer with nothing named to point at.
    if _REFERENT_RE.search(text) and not sensors:
        return True
    # "pressure?", "yesterday?" — a bare slot, no question of its own.
    if len(words) <= 3 and (sensors or points or windows) and not _QUESTION_WORD_RE.search(text):
        return True
    return False


def _replace_spans(text: str, spans: list[tuple[int, int]], replacement: str) -> str:
    """Replace the first span with `replacement` and drop the rest."""
    out = text
    for i, (start, end) in enumerate(sorted(spans, reverse=True)):
        is_first = i == len(spans) - 1
        out = out[:start] + (replacement if is_first else "") + out[end:]
    return re.sub(r"\s{2,}", " ", out).strip()


_PAST_RE = re.compile(r"\b(?:yesterday|last|past|previous|earlier|ago|this\s+morning|overnight|since|between)\b|\d")


def windows_or_points_are_past(text: str) -> bool:
    """Whether a time the follow-up names is behind us, so "is" becomes "was"."""
    points, windows = vocab.find_time(text)
    return any(_PAST_RE.search(text[s:e]) for s, e in points + windows)


def _by_rules(nq: NormalisedQuery, previous: str) -> Rewrite | None:
    """Swap the slots the follow-up names into the previous question."""
    # Referents mean something other than a slot is being carried over — "why
    # did it spike?" — which slot substitution cannot express.
    remainder = _CONNECTOR_RE.sub("", nq.match).strip(" ?.!,")
    if _REFERENT_RE.search(remainder):
        return None

    cur_sensors = vocab.find_sensors(nq.match)
    cur_points, cur_windows = vocab.find_time(nq.match)
    if not (cur_sensors or cur_points or cur_windows):
        return None

    # Everything in the follow-up must be a slot: "and pH?" yes, "and pH, and
    # is that normal?" no. Whatever is left after removing slots and filler
    # must be empty.
    filler = re.sub(
        r"\b(?:the|a|an|for|of|in|on|at|about|and|what|how|value|reading|readings|level|levels|too|as\s+well"
        r"|instead|then|now|please)\b",
        " ",
        remainder,
    )
    for pattern in (*vocab.SENSOR_RES.values(), vocab.TIME_POINT_RE, vocab.TIME_WINDOW_RE):
        filler = pattern.sub(" ", filler)
    if re.search(r"[a-z0-9]", filler):
        return None

    prev_match = previous.lower()
    rewritten = previous
    notes: list[str] = []

    if cur_sensors:
        prev_sensors = vocab.find_sensors(prev_match)
        new_names = " and ".join(
            str(vocab.SENSORS[name]["display"]) for name in dict.fromkeys(n for n, _, _ in cur_sensors)
        )
        if prev_sensors:
            rewritten = _replace_spans(rewritten, [(s, e) for _, s, e in prev_sensors], new_names)
            notes.append(f"sensor → {new_names}")
        else:
            return None  # nothing to swap a sensor into

    if cur_points or cur_windows:
        spans = cur_points + cur_windows
        new_time = " and ".join(nq.match[s:e] for s, e in sorted(spans))
        # "last 24 hours" reads as a phrase only with its preposition.
        if re.match(r"(?:last|past|previous)\b", new_time):
            new_time = f"over the {new_time}"
        prev_points, prev_windows = vocab.find_time(rewritten.lower())
        prev_spans = prev_points + prev_windows
        if prev_spans:
            rewritten = _replace_spans(rewritten, prev_spans, new_time)
        else:
            # "What is the current CO2?" → "and yesterday?" → the question is
            # now about a period; "current" no longer applies.
            base = vocab.LIVE_RE.sub("", rewritten).strip()
            base = re.sub(r"\s{2,}", " ", base)
            if windows_or_points_are_past(nq.match):
                base = re.sub(r"^(what|how\s+much|how\s+high)\s+(?:is|'s)\b", r"\1 was", base, flags=re.I)
                base = re.sub(r"^what's\b", "What was", base, flags=re.I)
            rewritten = f"{base.rstrip(' ?.')} {new_time}?"
        notes.append(f"time → {new_time}")

    rewritten = re.sub(r"\s+([?.!,])", r"\1", rewritten).strip()
    if not rewritten.endswith(("?", ".", "!")):
        rewritten += "?"
    return Rewrite(text=rewritten, method="rules", basis=previous, note="; ".join(notes))


_MODEL_SYSTEM = (
    "You rewrite an operator's follow-up message into ONE standalone question for a read-only "
    "monitoring assistant of a CO2 sorption reactor. Resolve words like 'it', 'that' and 'the "
    "same' using the previous question and answer. Keep the operator's meaning exactly: do not "
    "answer it, do not add facts, numbers or new requests, and do not turn a question into a "
    "command. If the message already stands alone, return it unchanged. Reply with JSON "
    '{"question": "<standalone question>"} and nothing else.\n\n'
    "Example 1\nPrevious question: What is the current pressure?\n"
    "Follow-up: why is it so high?\n"
    '{"question": "Why is the current pressure so high?"}\n\n'
    "Example 2\nPrevious question: Why did the CO2 reading spike at 10:00?\n"
    "Follow-up: what should I do about it?\n"
    '{"question": "What should I do about the CO2 reading spike at 10:00?"}'
)


def _by_model(nq: NormalisedQuery, previous: str, reply: str | None) -> Rewrite | None:
    context = f"Previous question: {previous}\n"
    if reply:
        context += f"Previous answer: {reply[:_REPLY_CHARS]}\n"
    data, tag = local_model.ask_json(
        _MODEL_SYSTEM, f"{context}Follow-up: {nq.text}\nStandalone question:", max_tokens=96
    )
    question = (data or {}).get("question")
    if not isinstance(question, str):
        return None
    question = " ".join(question.split())
    if not question or len(question) > _MAX_REWRITE_CHARS:
        return None
    # Handed back as it came in: nothing was resolved, so it is not a rewrite,
    # and recording it as one would overstate what the step did.
    if question.strip(" ?.!").lower() == nq.text.strip(" ?.!").lower():
        return None
    return Rewrite(text=question, method="model", basis=previous, note=f"rewritten by {tag}")


def condense(
    nq: NormalisedQuery, history: list[dict[str, Any]], *, use_model: bool = True
) -> Rewrite:
    """The standalone form of `nq`, given the turns before it."""
    previous, reply = _previous(history)
    if not is_follow_up(nq, previous):
        return Rewrite(text=nq.text, method="none", note="stands alone" if previous else "first turn")

    assert previous is not None
    by_rules = _by_rules(nq, previous)
    if by_rules:
        return by_rules
    if use_model:
        by_model = _by_model(nq, previous, reply)
        if by_model:
            return by_model
    return Rewrite(
        text=nq.text,
        method="none",
        basis=previous,
        note="looks like a follow-up, but no rewrite was possible; answered as asked",
    )
