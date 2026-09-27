"""Steps 1–4 of PROJECT.md §7.1: understand a question before anything answers it.

    raw message
      │  normalise            clean, reject empty / too long, flag language
      │  guard (raw)          refuse a command before any model runs
      │  condense             rewrite a follow-up into a standalone question
      │  classify             one of the eight intents
      │  guard (standalone)   refuse a command the rewrite revealed
      ▼
    Understanding — the standalone question, its intent, and either
                    `reply` (the turn ends here) or None (steps 5–11 continue)

## Why the guard runs twice

§7.1 puts the guard at step 4, after classification, and §7.4 puts
condensation before classification — but condensation may call a model, and
§7.1 says a control request gets *no* model call. Guarding the raw message
first satisfies both: "open ABV-1" is refused before anything runs, and "open
it" is refused after the rewrite resolves "it". Both passes are the same
deterministic check.

## Turns that end here

Four kinds never reach the answering model, each with a fixed reply:

| `stop` | reply |
|---|---|
| `too_long` | asks for a shorter question |
| a guard reason | §7.1's refusal (see `safety`) |
| `out_of_scope` | says what the assistant covers |

A turn that ends here is still a turn: the transcript records both sides and
`conversation_logs` records the intent and why it stopped, so the evaluation can
count refusals the same way it counts answers.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from . import condense as condense_mod
from . import intent as intent_mod
from . import safety
from .normaliser import MAX_QUERY_CHARS, NormalisedQuery, normalise

__all__ = ["Understanding", "understand", "normalise", "safety", "MAX_QUERY_CHARS"]

REPLY_TOO_LONG = (
    "That message is too long for me to answer reliably ({length:,} characters; the limit is "
    "{limit:,}). Please ask a shorter question — one reading, trend or procedure at a time."
)
REPLY_OUT_OF_SCOPE = (
    "That is outside what I can help with. I answer questions about the CO2 sorption reactor: "
    "current and past sensor readings, trends, anomalies, and the lab's procedures."
)
REPLY_ABOUT = (
    "I'm Daedalus, a read-only assistant for the CO2 sorption reactor. Ask me about current or "
    'past readings ("What is the CO2 level now?"), trends ("Average temperature over the last '
    'hour?"), anomalies ("Was there an anomaly this morning?"), or procedures ("What should I '
    'do if the NDIR drifts?"). I cannot operate the reactor.'
)
REPLY_SMALLTALK = (
    "Hello — I'm Daedalus. Ask me about the reactor's readings, trends, anomalies or "
    "procedures whenever you're ready."
)


@dataclass
class Understanding:
    raw: str
    normalised: NormalisedQuery
    standalone: str
    rewrite_method: str
    rewrite_note: str | None
    intent: str | None
    intent_method: str | None
    intent_confidence: str | None
    intent_reason: str | None
    signals: dict[str, Any]
    guard_reason: str | None
    guard_clause: str | None
    #: The fixed reply when the turn ends here; None when steps 5–11 continue.
    reply: str | None
    #: None | 'too_long' | 'out_of_scope' | a guard reason.
    stop: str | None
    timings_ms: dict[str, int] = field(default_factory=dict)

    @property
    def rewritten(self) -> bool:
        return self.rewrite_method != "none"

    def as_event(self) -> dict[str, Any]:
        """What the stream and the transcript's `done` result carry."""
        return {
            "standalone_query": self.standalone,
            "rewritten": self.rewritten,
            "rewrite_method": self.rewrite_method,
            "intent": self.intent,
            "intent_method": self.intent_method,
            "intent_confidence": self.intent_confidence,
            "intent_reason": self.intent_reason,
            "signals": self.signals,
            "language": self.normalised.language,
            "blocked": self.guard_reason is not None,
            "guard_reason": self.guard_reason,
            "stop": self.stop,
            "timings_ms": self.timings_ms,
        }


def _ms(since: float) -> int:
    return int((time.perf_counter() - since) * 1000)


def understand(
    raw: str,
    history: list[dict[str, Any]] | None = None,
    *,
    use_model: bool = True,
) -> Understanding:
    """Run steps 1–4 on one message. Never calls a model for a refused one.

    `history` is the session's earlier messages (oldest first), as
    `chat_service` returns them. `use_model=False` keeps every step on rules —
    what the tests use, and what a machine with no local model gets anyway.
    """
    history = history or []
    timings: dict[str, int] = {}

    t = time.perf_counter()
    nq = normalise(raw)
    timings["normalise"] = _ms(t)

    def done(**kw: Any) -> Understanding:
        base: dict[str, Any] = dict(
            raw=raw, normalised=nq, standalone=nq.text, rewrite_method="none", rewrite_note=None,
            intent=None, intent_method=None, intent_confidence=None, intent_reason=None,
            signals={}, guard_reason=None, guard_clause=None, reply=None, stop=None,
            timings_ms=timings,
        )
        base.update(kw)
        return Understanding(**base)

    if nq.problem == "too_long":
        return done(
            stop="too_long",
            reply=REPLY_TOO_LONG.format(length=nq.length, limit=MAX_QUERY_CHARS),
        )

    t = time.perf_counter()
    verdict = safety.check(nq.match)
    timings["guard"] = _ms(t)
    if verdict.blocked:
        return done(
            intent="unsafe_control", intent_method="rules", intent_confidence="high",
            intent_reason="refused by the safety guard", guard_reason=verdict.reason,
            guard_clause=verdict.clause, reply=verdict.message, stop=verdict.reason,
        )

    t = time.perf_counter()
    rewrite = condense_mod.condense(nq, history, use_model=use_model)
    timings["condense"] = _ms(t)
    standalone_nq = normalise(rewrite.text) if rewrite.method != "none" else nq

    if rewrite.method != "none":
        t = time.perf_counter()
        verdict = safety.check(standalone_nq.match)
        timings["guard_standalone"] = _ms(t)
        if verdict.blocked:
            return done(
                standalone=standalone_nq.text, rewrite_method=rewrite.method,
                rewrite_note=rewrite.note, intent="unsafe_control", intent_method="rules",
                intent_confidence="high",
                intent_reason="refused by the safety guard once the follow-up was resolved",
                guard_reason=verdict.reason, guard_clause=verdict.clause,
                reply=verdict.message, stop=verdict.reason,
            )

    t = time.perf_counter()
    result = intent_mod.classify(standalone_nq.match, standalone_nq.text, use_model=use_model)
    timings["classify"] = _ms(t)

    reply = stop = None
    if result.intent == "out_of_scope":
        stop = "out_of_scope"
        reply = {
            "smalltalk": REPLY_SMALLTALK,
            "about": REPLY_ABOUT,
        }.get(result.subtype or "", REPLY_OUT_OF_SCOPE)

    return done(
        standalone=standalone_nq.text,
        rewrite_method=rewrite.method,
        rewrite_note=rewrite.note,
        intent=result.intent,
        intent_method=result.method,
        intent_confidence=result.confidence,
        intent_reason=result.reason,
        signals=result.signals.as_dict(),
        reply=reply,
        stop=stop,
    )
