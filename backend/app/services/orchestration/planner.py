"""Step 5 of PROJECT.md §7.1: decide which tools answer this question.

Deterministic, from the intent and the signals `query_pipeline` already read.
The model is not asked which tools to call. That is a deliberate choice for this
milestone, not a missing feature: a plan made by rules is replayable from the
log and explainable in one line per call (`PlannedCall.why`), and the seven
intents were defined so that each one maps to a fixed tool set
(`architecture/07` §Step 5). Letting a model plan is what Track 2's agent loop
(M6) is for, and that is measured against this baseline rather than replacing
it.

| intent | calls |
|---|---|
| `live_status` | `get_live_reading` per named sensor, or `all` |
| `historical_query` | `get_live_reading(timestamp)` per sensor |
| `trend_query` | `get_trend` per sensor, over the window |
| `sop_query` | retrieval on the selected track |
| `mixed_query` | `get_trend` + retrieval |

## Retrieval follows the track, and only the track

§5's comparison: the planner asks for "retrieval" and gets the selected arm's
tool — `search_corpus` on Track 1, `graph_walk` (entry search plus a fixed,
recorded walk) on Track 2. The registry gate would refuse the other arm anyway;
planning only what will be allowed keeps refusals out of `tool_logs`, where they
would read as failures.

## When it asks instead

A historical question whose time could not be placed ("CO₂ during the last
run") ends the turn with a clarifying question. Answering it for some other
time would be answering a question nobody asked — with a real number, which is
worse than no number. A window that is merely *absent* gets a stated default
instead, because "average temperature?" has an obvious reading and the answer
says which window it used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from .. import rag_config
from ..agent_tools import sensor as sensor_tools
from ..query_pipeline import Understanding, normalise
from . import timeparse

# vocabulary's sensor keys → the tool layer's whitelist.
_SENSOR_KEYS = {
    "temperature": "temperature",
    "pressure": "pressure",
    "ph": "ph",
    "level": "level",
    "co2": "co2_ppm",
    "mode": "mode",
}

# The tools the chat path can plan, and nothing else. Settings → Agent Tools'
# simple view is drawn from this, so it cannot list a tool the planner never
# calls or miss one it does.
SENSOR_TOOLS = ("get_live_reading", "get_trend")
# Track 2 has two retrieval modes (`rag_config` → graph.mode): the agent loop,
# and the fixed walk it is measured against inside the track.
RETRIEVAL_TOOLS = {"vector": "search_corpus", "graph": "graph_walk"}
GRAPH_MODE_TOOLS = {"walk": "graph_walk", "agent": "graph_agent"}


def retrieval_tool(track: str) -> str:
    """The one retrieval tool the selected track plans with."""
    if track == "graph":
        return GRAPH_MODE_TOOLS[rag_config.graph_settings()["mode"]]
    return RETRIEVAL_TOOLS[track]


def answering_tools() -> dict[str, Any]:
    """What answers a chat question right now: the sensor tools, and the selected track's retrieval."""
    track = rag_config.resolve()
    retrieval = retrieval_tool(track)
    return {
        "track": track,
        "sensor": list(SENSOR_TOOLS),
        "retrieval": retrieval,
        "tools": [*SENSOR_TOOLS, retrieval],
    }


# Enough to answer, few enough to fit an SLM's context next to the history.
MAX_SENSORS = 4
RETRIEVAL_TOP_K = 5
GRAPH_LIMIT = 6

DEFAULT_TREND_WINDOW = timedelta(hours=1)
# A point in time asked "why" about is read as the minutes around it.
POINT_CONTEXT = timedelta(minutes=15)

_AGGREGATION_CUES = (
    ("max", r"\b(?:max|maximum|highest|peak|peaked|top)\b"),
    ("min", r"\b(?:min|minimum|lowest|bottom)\b"),
    ("count", r"\b(?:how\s+many|count|number\s+of)\b"),
    ("first", r"\b(?:first|initial|start(?:ing)?\s+value)\b"),
    ("latest", r"\b(?:latest|last\s+value|most\s+recent|final)\b"),
    ("average", r"\b(?:average|avg|mean|typical|purata)\b"),
)

CLARIFY_TIME = (
    "Which time do you mean? I couldn't place \"{phrase}\" on the clock. You can say, for "
    'example, "at 14:30", "over the last hour" or "this morning".'
)


@dataclass
class PlannedCall:
    tool: str
    arguments: dict[str, Any]
    #: One line an examiner can read: why this call is in the plan.
    why: str


@dataclass
class Plan:
    intent: str
    sensors: list[str]
    time: timeparse.TimeScope
    calls: list[PlannedCall] = field(default_factory=list)
    #: 'vector' | 'graph' | None — set when the plan retrieves.
    track: str | None = None
    retrieval_query: str | None = None
    #: When set, the turn ends with this question instead of an answer.
    clarify: str | None = None
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "sensors": self.sensors,
            "time": self.time.as_dict(),
            "calls": [{"tool": c.tool, "arguments": c.arguments, "why": c.why} for c in self.calls],
            "track": self.track,
            "retrieval_query": self.retrieval_query,
            "clarify": self.clarify,
            "notes": self.notes,
        }


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def _aggregation(match: str) -> str:
    for name, pattern in _AGGREGATION_CUES:
        if re.search(pattern, match):
            return name
    return "average"


def _latest_reading() -> datetime | None:
    try:
        return sensor_tools._latest_timestamp()  # noqa: SLF001 — same read the tools make
    except Exception:  # noqa: BLE001 — no sensor DB means no anchor, not no plan
        return None


def plan(understood: Understanding, *, now: datetime | None = None) -> Plan:
    """The tool calls for one understood question. Never calls a tool itself."""
    match = normalise(understood.standalone).match if understood.rewritten else understood.normalised.match
    intent = understood.intent or "sop_query"
    sensors = [
        _SENSOR_KEYS[s] for s in (understood.signals.get("sensors") or ()) if s in _SENSOR_KEYS
    ][:MAX_SENSORS]
    scope = timeparse.resolve(match, now=now, latest=_latest_reading())
    p = Plan(intent=intent, sensors=sensors, time=scope)
    p.notes.extend(scope.notes)
    numeric = [s for s in sensors if s in sensor_tools.NUMERIC_SENSORS]

    def window(default: timedelta) -> tuple[str, str]:
        if scope.kind == "window" and scope.start and scope.end:
            return _iso(scope.start), _iso(scope.end)
        if scope.kind == "point" and scope.point:
            return _iso(scope.point - POINT_CONTEXT), _iso(scope.point + POINT_CONTEXT)
        p.notes.append(
            f"no time was given, so the window is the {_describe(default)} up to {_iso(scope.anchor)}"
        )
        return _iso(scope.anchor - default), _iso(scope.anchor)

    def retrieval() -> None:
        track = rag_config.resolve()
        p.track, p.retrieval_query = track, understood.standalone
        if track == "graph":
            tool = retrieval_tool("graph")
            p.calls.append(PlannedCall(
                tool, {"query": understood.standalone, "limit": GRAPH_LIMIT},
                "Track 2 is selected: enter the graph from the question and "
                + ("let the local model choose each hop" if tool == "graph_agent"
                   else "walk the fixed path to procedures"),
            ))
        else:
            p.calls.append(PlannedCall(
                RETRIEVAL_TOOLS["vector"], {"query": understood.standalone, "top_k": RETRIEVAL_TOP_K},
                "Track 1 is selected: find the corpus passages nearest the question",
            ))

    if not scope.understood and intent in ("historical_query", "trend_query", "mixed_query"):
        p.clarify = CLARIFY_TIME.format(phrase=scope.phrase or "that")
        return p

    if intent == "historical_query" and scope.kind == "window":
        # "CO₂ this morning" was filed as a point question; it is a window of values.
        p.notes.append("the question names a window, so it is answered as a trend")
        intent = p.intent = "trend_query"
    if intent == "historical_query" and scope.kind != "point":
        p.clarify = CLARIFY_TIME.format(phrase=scope.phrase or "then")
        return p

    if intent == "live_status":
        for s in sensors or ["all"]:
            p.calls.append(PlannedCall("get_live_reading", {"sensor": s}, f"current value of {s}"))

    elif intent == "historical_query":
        at = _iso(scope.point)  # type: ignore[arg-type]
        for s in sensors or ["all"]:
            p.calls.append(PlannedCall(
                "get_live_reading", {"sensor": s, "timestamp": at},
                f"{s} nearest {scope.phrase!r} ({at})",
            ))

    elif intent == "trend_query":
        start, end = window(DEFAULT_TREND_WINDOW)
        aggregation = _aggregation(match)
        targets = numeric or list(sensor_tools.NUMERIC_SENSORS)
        if not numeric:
            p.notes.append("no numeric sensor was named, so every numeric sensor is summarised")
        for s in targets:
            p.calls.append(PlannedCall(
                "get_trend",
                {"sensor": s, "start_time": start, "end_time": end, "aggregation": aggregation,
                 # A series for five sensors is five hundred points of prompt; one is useful.
                 "include_series": len(targets) == 1},
                f"{aggregation} of {s} over {start} – {end}",
            ))

    elif intent == "sop_query":
        retrieval()

    elif intent == "mixed_query":
        start, end = window(DEFAULT_TREND_WINDOW)
        targets = numeric or (["co2_ppm"] if "co2" in match else [])
        for s in targets:
            p.calls.append(PlannedCall(
                "get_trend",
                {"sensor": s, "start_time": start, "end_time": end,
                 "aggregation": _aggregation(match), "include_series": len(targets) == 1},
                f"what {s} did around the time asked about",
            ))
        if not targets:
            p.calls.append(PlannedCall(
                "get_live_reading", {"sensor": "all"},
                "no sensor was named; the reactor's current state for context",
            ))
        retrieval()

    return p


def _describe(span: timedelta) -> str:
    hours = span.total_seconds() / 3600
    return "last hour" if hours == 1 else f"last {hours:g} hours"
