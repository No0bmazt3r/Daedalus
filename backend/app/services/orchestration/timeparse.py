"""Turning "at 10:00", "over the last hour", "this morning" into UTC bounds.

The sensor tools take ISO timestamps; operators speak in wall-clock phrases.
Something has to convert one into the other, and Rule 3 decides what: not the
model. A model that turns "this morning" into a date has supplied the first
number in the chain from its own head, and every figure computed over that
window is then wrong in a way that looks right. So the conversion is these
rules, and the result travels into the evidence pack with the phrase it came
from — the answer can say *which* window it described.

## Whose clock

Operators mean the clock on the lab wall. `site_tz()` is that zone: the one
picked in Settings → Assistant, else `DAEDALUS_TZ` (an IANA name, e.g.
`Asia/Kuala_Lumpur`), else the browser's detected zone, else this machine's
(see `assistant_settings`). Rows are stored in UTC, so every bound is converted before
it leaves this module.

## What "now" means when the feed has stopped

When the newest reading is more than `FEED_GAP` old, relative phrases are
anchored to that reading instead of the wall clock, and `anchored_to_data` says
so. "The last hour" of a feed that stopped two weeks ago is, usefully, the last
hour of data; measured from the wall clock it is an empty window and a
confident "no readings". The live-reading tool separately marks the value
`stale`, and the prompt tells the model to say how old it is, so the anchoring
never hides the gap — it only stops a dead feed answering every question with
nothing.

## What it does not understand

Anything not listed below comes back `understood=False` with the phrase, and the
planner decides: ask, or use a stated default window. It never guesses a date.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Any

from .. import assistant_settings

FEED_GAP = timedelta(minutes=10)


def site_tz() -> tzinfo:
    """The site clock, read per call so a change in Settings applies at once."""
    return assistant_settings.site_tz()


@dataclass
class TimeScope:
    #: 'none' | 'point' | 'window'
    kind: str
    anchor: datetime
    anchored_to_data: bool
    point: datetime | None = None
    start: datetime | None = None
    end: datetime | None = None
    #: The words it came from, for the evidence pack and the log.
    phrase: str | None = None
    #: False when a time phrase was present but not understood.
    understood: bool = True
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        def iso(v: datetime | None) -> str | None:
            return v.astimezone(timezone.utc).replace(microsecond=0).isoformat() if v else None

        return {
            "kind": self.kind,
            "phrase": self.phrase,
            "understood": self.understood,
            "point": iso(self.point),
            "start": iso(self.start),
            "end": iso(self.end),
            "anchor": iso(self.anchor),
            "anchored_to_data": self.anchored_to_data,
            "timezone": str(site_tz()),
            "notes": self.notes,
        }


_UNITS = {
    "second": timedelta(seconds=1), "sec": timedelta(seconds=1),
    "minute": timedelta(minutes=1), "min": timedelta(minutes=1),
    "hour": timedelta(hours=1), "hr": timedelta(hours=1), "h": timedelta(hours=1),
    "day": timedelta(days=1), "week": timedelta(weeks=1),
    "shift": timedelta(hours=8), "month": timedelta(days=30),
}
_COUNT_WORDS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "ten": 10, "twelve": 12, "fifteen": 15, "twenty": 20, "thirty": 30,
    "few": 3, "couple of": 2, "several": 3,
}

_CLOCK = r"(\d{1,2})(?:[:.](\d{2}))?(?::(\d{2}))?\s*(am|pm)?"

_LAST_RE = re.compile(
    r"\b(?:last|past|previous)\s+(?:(\d+|a|an|one|two|three|four|five|six|ten|twelve|fifteen|twenty|thirty"
    r"|few|couple\s+of|several)\s+)?(seconds?|secs?|minutes?|mins?|hours?|hrs?|h|days?|weeks?|shifts?|months?)\b"
)
_ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?\b")
_BETWEEN_RE = re.compile(rf"\bbetween\s+{_CLOCK}\s+and\s+{_CLOCK}")
_SINCE_RE = re.compile(rf"\bsince\s+(?:{_CLOCK}|(this\s+morning|yesterday|midnight|morning))\b")
_POINT_RE = re.compile(
    rf"\b(?:at|around|about|near|by|pukul)\s+{_CLOCK}\b"
    r"|\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b"
    r"|\b(\d{1,2})\s*(am|pm)\b"
)
# Named parts of a day, as [start hour, end hour) on the anchor's local date.
_PARTS = {
    "this morning": (6, 12), "pagi ini": (6, 12),
    "this afternoon": (12, 18),
    "this evening": (18, 24), "tonight": (18, 24),
    "overnight": (0, 6),
}


def _clock(h: str, m: str | None, s: str | None, ampm: str | None) -> time | None:
    hour, minute, second = int(h), int(m or 0), int(s or 0)
    if ampm == "pm" and hour < 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59 or second > 59:
        return None
    return time(hour, minute, second)


def _on(day: date, t: time, tz: tzinfo | None = None) -> datetime:
    return datetime.combine(day, t, tzinfo=tz or site_tz())


def _not_after(value: datetime, anchor: datetime) -> datetime:
    """A bare clock time means the most recent occurrence, never tomorrow's."""
    return value - timedelta(days=1) if value > anchor + timedelta(minutes=1) else value


def resolve(match: str, *, now: datetime | None = None, latest: datetime | None = None) -> TimeScope:
    """Read the time the question is about. `match` is the normalised lower-case text."""
    now = now or datetime.now(timezone.utc)
    anchored = bool(latest and now - latest > FEED_GAP)
    anchor = latest if anchored and latest else now
    scope = TimeScope(kind="none", anchor=anchor, anchored_to_data=anchored)
    if anchored:
        scope.notes.append(
            "the sensor feed has no reading since "
            f"{latest.astimezone(timezone.utc).isoformat(timespec='seconds')}; "  # type: ignore[union-attr]
            "relative times are measured back from that reading, not from the wall clock"
        )
    # "at 15:15 UTC" means UTC, whatever the site's zone is.
    tz: tzinfo = timezone.utc if re.search(r"\b(?:utc|gmt|zulu)\b", match) else site_tz()
    day = anchor.astimezone(tz).date()

    def on(d: date, t: time) -> datetime:
        return _on(d, t, tz)

    def window(start: datetime, end: datetime, phrase: str, *, recent: bool = False) -> TimeScope:
        # A named part of the day means its most recent occurrence: "this
        # afternoon" asked at 01:00 is the afternoon that just ended, not one
        # that has not started. An explicit date is never moved.
        if recent and start > anchor:
            start, end = start - timedelta(days=1), end - timedelta(days=1)
        scope.kind, scope.start, scope.end, scope.phrase = "window", start, min(end, anchor), phrase
        return scope

    if m := _ISO_RE.search(match):
        y, mo, d, hh, mm, ss = m.groups()
        try:
            the_day = date(int(y), int(mo), int(d))
        except ValueError:
            scope.understood, scope.phrase = False, m.group(0)
            return scope
        if hh is None:
            return window(on(the_day, time(0)), on(the_day, time(0)) + timedelta(days=1), m.group(0))
        t = _clock(hh, mm, ss, None)
        if t is None:
            scope.understood, scope.phrase = False, m.group(0)
            return scope
        scope.kind, scope.point, scope.phrase = "point", on(the_day, t), m.group(0)
        return scope

    if m := _BETWEEN_RE.search(match):
        a, b = _clock(*m.groups()[0:4]), _clock(*m.groups()[4:8])
        if a and b:
            start, end = on(day, a), on(day, b)
            if end <= start:
                end += timedelta(days=1)
            # Moved together: shifting only the start is how "between 23:00 and
            # 23:30" became a window ending at the anchor, hours later.
            return window(start, end, m.group(0), recent=True)

    if m := _LAST_RE.search(match):
        count_word, unit = m.group(1), m.group(2)
        count = int(count_word) if count_word and count_word.isdigit() else _COUNT_WORDS.get(
            re.sub(r"\s+", " ", count_word or "a"), 1
        )
        key = unit.rstrip("s") if unit not in ("h",) else "h"
        span = _UNITS.get(key) or _UNITS.get(key[:3]) or timedelta(hours=1)
        return window(anchor - span * count, anchor, m.group(0))

    if m := _SINCE_RE.search(match):
        if m.group(1):
            t = _clock(*m.groups()[0:4])
            if t:
                return window(_not_after(on(day, t), anchor), anchor, m.group(0))
        named = m.group(5)
        if named in ("this morning", "morning"):
            return window(on(day, time(6)), anchor, m.group(0))
        if named == "yesterday":
            return window(on(day - timedelta(days=1), time(0)), anchor, m.group(0))
        if named == "midnight":
            return window(on(day, time(0)), anchor, m.group(0))

    for phrase, (h0, h1) in _PARTS.items():
        if re.search(rf"\b{phrase}\b", match):
            start = on(day, time(h0))
            end = on(day, time(0)) + timedelta(days=1) if h1 == 24 else on(day, time(h1))
            return window(start, end, phrase, recent=True)

    if re.search(r"\blast\s+night\b", match):
        return window(on(day - timedelta(days=1), time(18)), on(day, time(6)), "last night")
    if re.search(r"\b(?:yesterday|semalam)\b", match):
        y = day - timedelta(days=1)
        return window(on(y, time(0)), on(day, time(0)), "yesterday")
    if re.search(r"\b(?:today|hari\s+ini|so\s+far(?:\s+today)?|earlier(?:\s+today)?)\b", match):
        return window(on(day, time(0)), anchor, "today")
    if re.search(r"\bthis\s+week\b", match):
        return window(anchor - timedelta(days=7), anchor, "this week")
    if re.search(r"\bthis\s+shift\b", match):
        return window(anchor - timedelta(hours=8), anchor, "this shift")

    if m := _POINT_RE.search(match):
        g = m.groups()
        if g[0] is not None:
            t = _clock(g[0], g[1], g[2], g[3])
        elif g[4] is not None:
            t = _clock(g[4], g[5], g[6], g[7])
        else:
            t = _clock(g[8], None, None, g[9])
        if t is None:
            scope.understood, scope.phrase = False, m.group(0).strip()
            return scope
        scope.kind, scope.point, scope.phrase = "point", _not_after(on(day, t), anchor), m.group(0).strip()
        return scope

    # A time phrase the classifier saw but nothing here could place: "this run",
    # "last cycle". Reported, not guessed.
    if m := re.search(r"\b(?:this|last)\s+(?:run|cycle|batch)\b", match):
        scope.understood, scope.phrase = False, m.group(0)
    return scope
