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
  checked by what they refer to — the evidence names the window — not as
  quantities; see `validator` for the limitation this implies.
- **List markers.** `1.` or `2)` opening a line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_LABEL_RE = re.compile(r"\[\s*[A-Z]\d+(?:\s*[,;]\s*[A-Z]\d+)*\s*\]")
_ISO_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)?")
_CLOCK_RE = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b")
_LIST_MARKER_RE = re.compile(r"(?m)^\s*\d{1,2}[.)]\s")
_NUMBER_RE = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")


@dataclass(frozen=True)
class Number:
    text: str
    value: float
    #: Digits after the point, as written — what "matches" is judged at.
    decimals: int


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
    for pattern in (_LABEL_RE, _ISO_RE, _CLOCK_RE, _LIST_MARKER_RE):
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
        out.append((Number(text=m.group(0), value=float(raw), decimals=decimals), (m.start(), m.end())))
    return out


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
