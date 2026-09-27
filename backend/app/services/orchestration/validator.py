"""Step 10 of PROJECT.md §7.1: check the answer before the operator relies on it.

| check | fails when | reason |
|---|---|---|
| empty | nothing but whitespace came back | `empty` |
| length | longer than `MAX_ANSWER_CHARS` | `too_long` |
| numbers | a quantity not in this turn's evidence | `unsupported_number` |
| stale numbers | …and that quantity *is* in the replayed history | `stale_history_number` |
| citations | a label like `[S7]` that the pack never issued | `unknown_citation` |
| control language | "I have opened ABV-1", "I'll set the temperature" | `control_claim` |

A failed answer is replaced by §7.1's fixed fallback — *"I could not generate a
grounded answer from the available data."* — and the model's text is kept in
the audit row, not the transcript. The operator never reads an unsupported
number as though it were checked; the evaluation can still count what the
model tried to say.

## Numbers are checked against *this turn's* evidence only

§7.4's hazard: turn 3 said "CO₂ is 470.2 ppm", and turn 9's prompt replays
turn 3. A model that repeats 470.2 as the current value has stated a number
nobody re-fetched. So history is not evidence here — a number found only in
history fails, and gets its own reason, because "the model recycled a stale
value" and "the model invented a value" are different findings for §9.

## What is tolerated, and why

- **Numbers in the question.** "Is 900 ppm high?" — echoing 900 is not a claim.
- **Small integers (0–10) with no decimal point.** "Step 3", "two anomalies",
  "1 record". Rejecting these made nearly every procedural answer fail in
  testing, and a count that matters (anomalies, readings) is in the evidence
  anyway. This is the validator's known blind spot, stated rather than hidden.
- **Rounding.** `540` for `539.931`. See `numbers.supported`.
- **Clock times and dates are not checked.** They are stripped before numbers
  are compared. A model can therefore misstate *when* while every quantity is
  right; catching that needs time-aware matching, which is listed as future
  work rather than approximated here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import numbers
from .evidence import EvidencePack

FALLBACK = "I could not generate a grounded answer from the available data."
MAX_ANSWER_CHARS = 4000
_SMALL_INT = 10

# `[S1]`, and the grouped form small models also write: `[G6, G7]`.
_CITATION_RE = re.compile(r"\[\s*([A-Z]\d+(?:\s*[,;]\s*[A-Z]\d+)*)\s*\]")

# First-person claims of having acted, or promising to. Questions about control
# are allowed through the guard, so the *answer* is where "Done — ABV-1 is now
# open" would appear.
_CONTROL_CLAIM_RE = re.compile(
    r"\b(?:i(?:'ve|\s+have)?|i'll|i\s+will|i\s+am|i'm|i\s+just|let\s+me)\s+(?:now\s+|just\s+|successfully\s+|gone\s+ahead\s+and\s+)?"
    r"(?:opened|closed|started|stopped|restarted|shut|turned|switched|set|adjusted|changed|increased|decreased"
    r"|raised|lowered|reduced|reset|activated|deactivated|enabled|disabled|acknowledged|silenced|vented|purged"
    r"|deleted|updated|modified|overwritten|cleared"
    r"|open|close|start|stop|restart|turn|switch|adjust|change|increase|decrease|raise|lower|reduce|activate"
    r"|deactivate|enable|disable|acknowledge|silence|vent|purge|delete|update|modify|clear)\b",
    re.IGNORECASE,
)
_DONE_RE = re.compile(
    r"^\s*(?:done|ok(?:ay)?|sure|completed?)\b[\s.!,:-]+.{0,80}\b(?:is|are|has\s+been|have\s+been)\s+now\b",
    re.IGNORECASE,
)


@dataclass
class Validation:
    passed: bool
    reasons: list[str] = field(default_factory=list)
    unsupported: list[str] = field(default_factory=list)
    stale: list[str] = field(default_factory=list)
    unknown_citations: list[str] = field(default_factory=list)
    cited: list[str] = field(default_factory=list)
    control_claim: str | None = None

    @property
    def hallucination(self) -> bool:
        """A number or source the evidence cannot account for."""
        return bool(self.unsupported or self.stale or self.unknown_citations)

    def as_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "reasons": self.reasons,
            "unsupported_numbers": self.unsupported,
            "stale_numbers": self.stale,
            "unknown_citations": self.unknown_citations,
            "cited": self.cited,
            "control_claim": self.control_claim,
        }


def validate(
    answer: str,
    pack: EvidencePack,
    *,
    question: str = "",
    history: list[dict[str, Any]] | None = None,
) -> Validation:
    v = Validation(passed=True)
    text = answer.strip()

    if not text:
        v.reasons.append("empty")
    if len(text) > MAX_ANSWER_CHARS:
        v.reasons.append("too_long")

    v.cited = sorted({
        label.strip() for group in _CITATION_RE.findall(text) for label in re.split(r"[,;]", group)
    })
    v.unknown_citations = [c for c in v.cited if c not in pack.labels]
    if v.unknown_citations:
        v.reasons.append("unknown_citation")

    m = _CONTROL_CLAIM_RE.search(text) or _DONE_RE.search(text)
    if m:
        v.control_claim = m.group(0).strip()
        v.reasons.append("control_claim")

    asked = numbers.values(question)
    history_numbers = numbers.values(
        "\n".join(str(h.get("content") or "") for h in (history or []))
    )
    for n in numbers.extract(text):
        if n.decimals == 0 and n.value <= _SMALL_INT:
            continue
        if n.value in asked or numbers.supported(n, pack.numbers):
            continue
        if numbers.supported(n, history_numbers):
            v.stale.append(n.text)
        else:
            v.unsupported.append(n.text)
    if v.unsupported:
        v.reasons.append("unsupported_number")
    if v.stale:
        v.reasons.append("stale_history_number")

    v.passed = not v.reasons
    return v


def grounded(v: Validation, pack: EvidencePack) -> bool:
    """Passed, had evidence, and cited some of it — what `grounded_flag` records."""
    return v.passed and not pack.empty and bool(set(v.cited) & pack.labels)
