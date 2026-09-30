"""Step 10 of PROJECT.md §7.1: check the answer before the operator relies on it.

| check | fails when | reason |
|---|---|---|
| empty | nothing but whitespace came back | `empty` |
| length | longer than `MAX_ANSWER_CHARS` | `too_long` |
| numbers | a quantity not in this turn's evidence | `unsupported_number` |
| stale numbers | …and that quantity *is* in the replayed history | `stale_history_number` |
| citations | a label like `[S7]` that the pack never issued | `unknown_citation` |
| control language | "I have opened ABV-1", "I'll set the temperature" | `control_claim` |
| reading citations | a sentence cites `[S1]` but states nothing on S1's line | `citation_mismatch` |

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

## A reading citation must support its sentence

A label only proves the line exists, not that the sentence says what the line
says. Seen on qwen3:1.7b with an empty corpus: *"[S1] The reactor's
temperature sensor measures ambient temperature, monitoring thermal
dynamics."* — no number, a cited reading, and an explanation nobody retrieved.
So every `S` citation is checked against its own line: the sentence it sits in
(or the one before, for a label written after the full stop) must state one of
that line's numbers, its mode *as a mode*, its anomaly flag, or its staleness.
Naming the sensor is not enough, because that is exactly the failure. `A`, `D`
and `G` lines are prose, where a fair check needs meaning rather than tokens,
so they are not checked this way — a known gap, like clock times.

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

# The other shapes small models give a citation, seen from qwen3:1.7b among
# others: `[EVIDENCE: S1]`, `[Source S1, D2]`, `(S1)`, `[S1 and S2]`. All mean
# `[S1]`, and are rewritten to it before the answer is checked or stored, so the
# validator, the transcript and the UI's citation chips see one format.
_LABELS = r"[A-Z]\d+(?:\s*(?:[,;&/]|and)\s*[A-Z]\d+)*"
_LOOSE_CITATION_RE = re.compile(
    rf"\[\s*(?:(?:evidence|source|sources|ref|refs|reference|citation|cite|see)\s*[:#\-]?\s*)?({_LABELS})\s*\]"
    rf"|\(\s*(?:(?:evidence|source|sources|ref|see)\s*[:#\-]?\s*)?({_LABELS})\s*\)",
    re.IGNORECASE,
)


def normalise_citations(text: str) -> str:
    """Rewrite every citation shape to `[S1]` / `[S1, D2]`. Labels are upper-cased."""
    def fix(m: re.Match[str]) -> str:
        labels = re.split(r"\s*(?:[,;&/]|\band\b)\s*", (m.group(1) or m.group(2)).strip(), flags=re.IGNORECASE)
        return "[" + ", ".join(label.upper() for label in labels if label) + "]"
    return _LOOSE_CITATION_RE.sub(fix, text)


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
    mismatched_citations: list[str] = field(default_factory=list)
    cited: list[str] = field(default_factory=list)
    control_claim: str | None = None

    @property
    def hallucination(self) -> bool:
        """A number or source the evidence cannot account for."""
        return bool(self.unsupported or self.stale or self.unknown_citations or self.mismatched_citations)

    def as_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "reasons": self.reasons,
            "unsupported_numbers": self.unsupported,
            "stale_numbers": self.stale,
            "unknown_citations": self.unknown_citations,
            "mismatched_citations": self.mismatched_citations,
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

    v.mismatched_citations = _mismatched_reading_citations(text, pack)
    if v.mismatched_citations:
        v.reasons.append("citation_mismatch")

    v.passed = not v.reasons
    return v


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_MODES = ("manual", "absorption", "desorption")
_FLAG_RE = re.compile(r"anomaly flag (\w+)", re.IGNORECASE)


def _supports(sentence: str, line: str) -> bool:
    """Does `sentence` state something that is on this reading's `line`?"""
    said = sentence.lower()
    shown = line.lower()
    line_numbers = numbers.values(line)
    for n in numbers.extract(sentence):
        if numbers.supported(n, line_numbers):
            return True
    # The mode, said as a mode — "critical for desorption processes" is not.
    if "mode" in said and any(m in said and m in shown for m in _MODES):
        return True
    flag = _FLAG_RE.search(line)
    if flag and flag.group(1).lower() in said and ("flag" in said or "normal" in said or "anomal" in said):
        return True
    if "stale" in shown and ("stale" in said or " old" in said or "days ago" in said):
        return True
    return False


def _mismatched_reading_citations(text: str, pack: EvidencePack) -> list[str]:
    lines = {i.label: i.line for i in pack.items if i.kind == "sensor"}
    if not lines:
        return []
    sentences = [s for s in _SENTENCE_RE.split(text) if s.strip()]
    bad: list[str] = []
    for index, sentence in enumerate(sentences):
        labels = {
            label.strip() for group in _CITATION_RE.findall(sentence)
            for label in re.split(r"[,;]", group)
        }
        context = sentence + (" " + sentences[index - 1] if index else "")
        for label in sorted(labels):
            if label in lines and not _supports(context, lines[label]) and label not in bad:
                bad.append(label)
    return bad


def grounded(v: Validation, pack: EvidencePack) -> bool:
    """Passed, had evidence, and cited some of it — what `grounded_flag` records."""
    return v.passed and not pack.empty and bool(set(v.cited) & pack.labels)
