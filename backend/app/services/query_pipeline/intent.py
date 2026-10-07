"""Step 3 of PROJECT.md §7.1: classify the intent.

Seven intents, fixed by the spec, each of which decides which tools step 5 will
plan (`docs/architecture/07-orchestration-layer.md` §5):

| intent | example | step 5 will plan |
|---|---|---|
| `live_status` | "What is the current temperature?" | `get_live_reading` |
| `historical_query` | "What was CO₂ at 10:00?" | `get_live_reading(timestamp)` |
| `trend_query` | "Average temperature over the last hour?" | `get_trend` |
| `sop_query` | "What should I do if NDIR drifts?" | `rag_retrieve` |
| `mixed_query` | "Why did CO₂ spike at 10:00?" | trend + retrieval |
| `unsafe_control` | "Open valve ABV-1" | nothing — the guard answers |
| `out_of_scope` | "Book a meeting" | nothing — a fixed reply |

## Rules first, a model only to break a tie

The classifier reads *signals* from the question — which sensors it names,
whether it gives a time point or a window, and cue phrases for live, trend,
procedure and cause — and decides from those. Every decision carries
`signals` and a one-line `reason`, so the evaluation can say *why* a question
was filed where it was, and a misclassification is a rule to fix rather than a
weight to retrain.

When the rules are unsure — conflicting cues, or a domain word and nothing else
— and a local model is available, it is asked to choose. Its answer is taken
only if it is one of the seven, and it can never move a question *out of*
`unsafe_control`: that decision belongs to the safety guard, which runs before
and after this and does not consult a model.

## What `unsafe_control` means here

The guard refuses commands; this classifier recognises them only so the label
is right when the guard has already refused. A question classified here as
`unsafe_control` that the guard allowed is not blocked by this module —
`understand()` reconciles the two, and the guard is authoritative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import local_model
from . import vocabulary as vocab

INTENTS = (
    "live_status",
    "historical_query",
    "trend_query",
    "sop_query",
    "mixed_query",
    "unsafe_control",
    "out_of_scope",
)


@dataclass(frozen=True)
class Signals:
    sensors: tuple[str, ...]
    time_points: int
    time_windows: int
    live: bool
    status: bool
    trend: bool
    sop: bool
    sop_weak: bool
    causal: bool
    domain: bool
    smalltalk: bool
    about: bool

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if v not in (False, 0, ())}


@dataclass(frozen=True)
class IntentResult:
    intent: str
    #: 'high' | 'low' — low is what makes the model tiebreaker run.
    confidence: str
    #: 'rules' | 'model'
    method: str
    reason: str
    signals: Signals
    #: For `out_of_scope`: 'smalltalk' | 'about' | None — decides the fixed reply.
    subtype: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def read_signals(match: str) -> Signals:
    points, windows = vocab.find_time(match)
    sensors = tuple(dict.fromkeys(name for name, _, _ in vocab.find_sensors(match)))
    return Signals(
        sensors=sensors,
        time_points=len(points),
        time_windows=len(windows),
        live=bool(vocab.LIVE_RE.search(match)),
        status=bool(vocab.STATUS_RE.search(match)),
        trend=bool(vocab.TREND_RE.search(match)),
        sop=bool(vocab.SOP_STRONG_RE.search(match)),
        sop_weak=bool(vocab.SOP_WEAK_RE.search(match)),
        causal=bool(vocab.CAUSAL_RE.search(match)),
        domain=bool(vocab.DOMAIN_RE.search(match)) or bool(sensors),
        smalltalk=bool(vocab.SMALLTALK_RE.match(match)),
        about=bool(vocab.ABOUT_RE.match(match)),
    )


def _rules(s: Signals) -> tuple[str, str, str, str | None]:
    """(intent, confidence, reason, subtype), from signals alone."""
    has_time = bool(s.time_points or s.time_windows)
    # Anything that needs a sensor value from the database.
    needs_data = bool(s.sensors or has_time or s.live or s.status)

    if s.smalltalk:
        return "out_of_scope", "high", "a greeting or acknowledgement", "smalltalk"
    if s.about:
        return "out_of_scope", "high", "a question about the assistant itself", "about"

    # Cause needs both halves: what the data did, and what the documents say
    # about why. §7.3's worked example is exactly this.
    if s.causal and needs_data:
        return "mixed_query", "high", "asks why something happened in the data", None
    # A procedure asked about a specific event: "what should I do about the
    # CO₂ spike at 10:00?"
    if s.sop and (has_time or s.live):
        return "mixed_query", "high", "asks for a procedure tied to specific readings", None

    if s.sop:
        return "sop_query", "high", "asks for a procedure or document", None

    if s.sensors or s.status:
        if s.trend:
            return "trend_query", "high", "asks for a statistic or trend over time", None
        if s.time_windows:
            # "CO2 this morning" without a statistic: a window of values.
            return "trend_query", "low", "names a time window but no statistic", None
        if s.time_points and not s.live:
            return "historical_query", "high", "asks for a value at a point in time", None
        if s.live or s.status:
            return "live_status", "high", "asks for the current value or state", None
        if s.sop_weak and not s.live:
            # "What is pH?" — a concept, not a reading.
            return "sop_query", "low", "asks what a measurement means", None
        # "What is the CO2?" — a sensor and nothing else reads as "now".
        return "live_status", "low", "names a sensor with no time, so the current value", None

    if s.trend and has_time:
        return "trend_query", "low", "a statistic over time with no sensor named", None
    if s.causal:
        return "sop_query", "low", "asks why, with nothing in the data to anchor it", None
    if s.domain:
        return "sop_query", "low", "about the reactor, with no data or procedure cue", None
    return "out_of_scope", "high", "nothing in it relates to the reactor", None


_MODEL_SYSTEM = (
    "You label questions sent to a read-only monitoring assistant for a lab-scale CO2 sorption "
    "reactor (sensors: temperature, pressure, pH, level, CO2, operating mode). Reply with JSON "
    '{"intent": "<label>"} and nothing else. Labels:\n'
    "live_status - the current value or state of a sensor or of the reactor\n"
    "historical_query - a value at one specific past time\n"
    "trend_query - a statistic or change over a period (average, max, trend)\n"
    "sop_query - a procedure, instruction, definition or explanation from documents\n"
    "mixed_query - needs sensor data AND documents, e.g. why something happened\n"
    "unsafe_control - asks the assistant to operate, change or write anything\n"
    "out_of_scope - unrelated to the reactor"
)


def _ask_model(question: str) -> str | None:
    data, _ = local_model.ask_json(_MODEL_SYSTEM, f"Question: {question}", max_tokens=24)
    intent = (data or {}).get("intent")
    # Refusing is the guard's decision alone, and it is made by rules. A model
    # that calls a question unsafe the guard allowed is overruled, never obeyed.
    return intent if intent in INTENTS and intent != "unsafe_control" else None


def classify(match: str, text: str, *, use_model: bool = True) -> IntentResult:
    """Label a (normalised, standalone) question with one of the seven intents.

    `match` is what the rules read; `text` is what the model is shown if the
    rules are unsure.
    """
    signals = read_signals(match)
    intent, confidence, reason, subtype = _rules(signals)

    if confidence == "low" and use_model:
        chosen = _ask_model(text)
        if chosen and chosen != intent:
            return IntentResult(
                intent=chosen,
                confidence="high",
                method="model",
                reason=f"rules were unsure ({reason}); the local model chose {chosen}",
                signals=signals,
                extra={"rules_intent": intent},
            )
        if chosen:
            confidence = "high"
            reason = f"{reason}; the local model agreed"

    return IntentResult(
        intent=intent,
        confidence=confidence,
        method="rules",
        reason=reason,
        signals=signals,
        subtype=subtype,
    )
