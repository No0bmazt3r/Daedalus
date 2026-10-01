"""Finding the numbers in a piece of text — the unit the response validator reasons in.

One extractor, used on both sides: on the evidence exactly as the model was
shown it, and on the model's answer. Using the same function for both is the
point — any quirk (how `CO₂` or `ABV-1` is skipped, how `1,234.5` is read)
applies equally to what was supplied and what was claimed, so it cannot make a
supported number look unsupported or the reverse.

## What is not a claim

- **Identifiers.** The `2` in `CO2`, the `1` in `ABV-1`, the `3` in `[S3]`.
  A digit glued to a letter (or to a letter and a hyphen) names something.
- **Timestamps, dates and clock times.** `2026-09-12`, `15:13:32`. These are
  not quantities, so they are blanked before numbers are read — and checked on
  their own terms by `times()` and `dates()` below, which the validator compares
  against the evidence as moments rather than as values.
- **List markers.** `1.` or `2)` opening a line.

## Units

A number carries the unit written straight after it (`5 ppm`, `3%`, `2 bar`),
or `ph` for `pH 7`. The validator uses it to tell a count ("3 readings"),
which it tolerates when small, from a measurement ("3 ppm"), which it never
does — a small value is still a value.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_LABEL_RE = re.compile(r"\[\s*[A-Z]\d+(?:\s*[,;]\s*[A-Z]\d+)*\s*\]")
_ISO_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)?")
_CLOCK_RE = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b")
_LIST_MARKER_RE = re.compile(r"(?m)^\s*\d{1,2}[.)]\s")
_NUMBER_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")

# Physical units a reactor quantity is written in. Durations ("5 minutes") are
# deliberately absent: they are how a model says how stale a reading is, and
# the evidence states those as a rounded age rather than a measured value.
UNITS = frozenset({
    "%", "percent", "ppm", "ppb", "°c", "°", "c", "degc", "degrees",
    "bar", "barg", "bara", "mbar", "kpa", "pa", "psi", "atm",
    "l/min", "lpm", "slpm", "sccm", "ml/min", "l", "ml", "m3", "m³",
    "kg", "g", "mg", "mm", "cm", "rpm", "mv", "ma", "kw",
    "mol", "mmol", "ph",
})
_UNIT_AFTER_RE = re.compile(r"\s?(°\s?c|°|%|[a-z]+(?:/[a-z]+)?³?\d?)", re.IGNORECASE)
_PH_BEFORE_RE = re.compile(r"\bph(?:\s+(?:of|is|was|at|=))?\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class Number:
    text: str
    value: float
    #: Digits after the point, as written — what "matches" is judged at.
    decimals: int
    #: The unit written with it, lower-cased, or None — see `UNITS`.
    unit: str | None = None


def _blank(pattern: re.Pattern[str], text: str) -> str:
    return pattern.sub(lambda m: " " * len(m.group(0)), text)


def extract(text: str) -> list[Number]:
    """Every quantity in `text`, in order."""
    return [n for n, _ in _scan(text)]


def redact(text: str, *, keep_small: int = 10, mask: str = "…") -> str:
    """`text` with every quantity above `keep_small` replaced by `mask`.

    For text that will be replayed into a prompt without being evidence — the
    rolling summary. A number there was true once and is stale by the time it
    is read again; removing it is simpler and safer than hoping the model treats
    it as history.
    """
    out, last = [], 0
    for n, (start, end) in _scan(text):
        if n.decimals == 0 and n.value <= keep_small:
            continue
        out.append(text[last:start])
        out.append(mask)
        last = end
    out.append(text[last:])
    return "".join(out)


def _scan(text: str) -> list[tuple[Number, tuple[int, int]]]:
    cleaned = text.replace("₂", "2")
    for pattern in (_LABEL_RE, _ISO_RE, _CLOCK_RE, _AMPM_CLOCK_RE, _HOUR_AMPM_RE,
                    _DAY_MONTH_RE, _MONTH_DAY_RE, _LIST_MARKER_RE):
        cleaned = _blank(pattern, cleaned)

    out: list[tuple[Number, tuple[int, int]]] = []
    for m in _NUMBER_RE.finditer(cleaned):
        before = cleaned[m.start() - 1] if m.start() else " "
        before2 = cleaned[m.start() - 2] if m.start() > 1 else " "
        if before.isalpha() or before == "_":
            continue  # CO2, pH7, v2
        if before == "-" and before2.isalpha():
            continue  # ABV-1, SOP-04
        if before == ".":
            continue  # the tail of a version string, 1.2.3
        raw = m.group(0).replace(",", "")
        decimals = len(raw.split(".", 1)[1]) if "." in raw else 0
        number = Number(text=m.group(0), value=float(raw), decimals=decimals,
                        unit=_unit(cleaned, m.start(), m.end()))
        out.append((number, (m.start(), m.end())))
    return out


def _unit(text: str, start: int, end: int) -> str | None:
    after = _UNIT_AFTER_RE.match(text, end)
    if after:
        unit = after.group(1).lower().replace(" ", "")
        if unit in UNITS:
            return unit
    if _PH_BEFORE_RE.search(text[max(0, start - 12):start]):
        return "ph"
    return None


# ── moments ──────────────────────────────────────────────────────────────────
#
# Times and dates are compared as what they denote, not as strings: "10:30",
# "10:30:00" and "10.30 am" are one minute of the day, and "12 September" is
# the same day as "2026-09-12". What is *not* normalised is the time zone — the
# evidence already writes every moment in both UTC and site time, so either
# reading the model chooses has a string to match.

_CLOCK_FULL_RE = re.compile(
    r"(?<![\d:.])(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?(?![\d:])\s*([ap]\.?m\.?)?",
    re.IGNORECASE,
)
# "10.30am" — only with the am/pm; a bare "10.30" is a number.
_AMPM_CLOCK_RE = re.compile(r"(?<![\d:.])\d{1,2}[:.]\d{2}\s*[ap]\.?m\.?(?![a-z])", re.IGNORECASE)
_HOUR_AMPM_RE = re.compile(r"(?<![\d:.])(\d{1,2})\s*([ap]\.?m\.?)(?![a-z])", re.IGNORECASE)
_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_MONTHS = {
    name: i for i, names in enumerate((
        ("jan", "january", "januari"), ("feb", "february", "februari"), ("mar", "march", "mac"),
        ("apr", "april"), ("may", "mei"), ("jun", "june"), ("jul", "july", "julai"),
        ("aug", "august", "ogos"), ("sep", "sept", "september"), ("oct", "october", "oktober"),
        ("nov", "november"), ("dec", "december", "disember"),
    ), start=1) for name in names
}
_MONTH_ALT = "|".join(sorted(_MONTHS, key=len, reverse=True))
_DAY_MONTH_RE = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({_MONTH_ALT})\b\.?(?:,?\s+(\d{{4}}))?", re.IGNORECASE)
_MONTH_DAY_RE = re.compile(rf"\b({_MONTH_ALT})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b(?:,?\s+(\d{{4}}))?", re.IGNORECASE)


@dataclass(frozen=True)
class Moment:
    text: str
    #: Minutes since midnight for a clock time; (year or 0, month, day) for a date.
    key: int | tuple[int, int, int]


def times(text: str) -> list[Moment]:
    """Every clock time in `text`, as minutes since midnight.

    Inside an ISO timestamp too: `2026-09-12T10:30:00` states 10:30 as much as
    "at 10:30" does, and the evidence writes its moments that way.
    """
    out: list[Moment] = []
    taken: list[tuple[int, int]] = []
    for m in _CLOCK_FULL_RE.finditer(text):
        hour, minute = int(m.group(1)), int(m.group(2))
        # "7.5" is a number, not half past seven: a dot only counts as a clock
        # separator with an am/pm after it.
        if m.group(0)[len(m.group(1))] == "." and not m.group(3):
            continue
        if hour > 23 or minute > 59:
            continue
        hour = _ampm(hour, m.group(3))
        out.append(Moment(m.group(0).strip(), hour * 60 + minute))
        taken.append(m.span())
    for m in _HOUR_AMPM_RE.finditer(text):
        if any(a <= m.start() < b for a, b in taken):
            continue
        hour = int(m.group(1))
        if 1 <= hour <= 12:
            out.append(Moment(m.group(0).strip(), _ampm(hour, m.group(2)) * 60))
    return out


def _ampm(hour: int, marker: str | None) -> int:
    if not marker:
        return hour
    pm = marker.lower().startswith("p")
    if hour == 12:
        return 12 if pm else 0
    return hour + 12 if pm and hour < 12 else hour


def dates(text: str) -> list[Moment]:
    """Every calendar date in `text`, as (year or 0, month, day)."""
    out: list[Moment] = []
    for m in _ISO_DATE_RE.finditer(text):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            out.append(Moment(m.group(0), (y, mo, d)))
    for m in _DAY_MONTH_RE.finditer(text):
        d, mo = int(m.group(1)), _MONTHS[m.group(2).lower()]
        if 1 <= d <= 31:
            out.append(Moment(m.group(0).strip(), (int(m.group(3) or 0), mo, d)))
    for m in _MONTH_DAY_RE.finditer(text):
        mo, d = _MONTHS[m.group(1).lower()], int(m.group(2))
        if 1 <= d <= 31:
            out.append(Moment(m.group(0).strip(), (int(m.group(3) or 0), mo, d)))
    return out


def date_supported(moment: Moment, known: set[tuple[int, int, int]]) -> bool:
    """A date without a year matches any year with that month and day."""
    year, month, day = moment.key  # type: ignore[misc]
    return any(m == month and d == day and (not year or y == year or not y) for y, m, d in known)


def values(text: str) -> set[float]:
    return {n.value for n in extract(text)}


def supported(n: Number, evidence: set[float]) -> bool:
    """Does the evidence contain this number, at the precision it was written?

    `540` is supported by `539.931`; `539.9` is; `539.8` is not. Rounding is
    the one transformation allowed — it states the same measurement less
    precisely. Anything else (a difference, a conversion, an average the tool
    did not compute) is a number the model made, and Rule 3 says it may not.
    """
    for e in evidence:
        if n.value == e:
            return True
        if round(e, n.decimals) == n.value:
            return True
        # Negative values arrive without their sign on one side or the other.
        if round(abs(e), n.decimals) == n.value:
            return True
    return False
