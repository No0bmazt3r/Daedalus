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
| document numbers | a sentence cites `[D1]`/`[G1]` for a number that line does not state | `document_citation_mismatch` |
| times and dates | a clock time or date nowhere in the evidence, question or history | `unsupported_time` |
| causes | "because…", "caused by…" with no cited source that itself states a cause | `uncited_cause` |
| rule 9 | a rig-specific sentence cited only to `[REFERENCE]` evidence, with no caveat | `uncaveated_reference` |

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
that line's numbers, its mode *as a mode*, or its staleness.
Naming the sensor is not enough, because that is exactly the failure. `D` and
`G` lines are prose, where a fair check needs meaning rather than tokens,
so they are not checked this way.

## A number cited to a document must be in that document

Prose needs meaning, but a number does not: 45 °C is on the cited line or it
is not. Seen on qwen3:1.7b (2026-11-11): "Ensure the temperature is ≤ 45°C
… [D1]", when 45 °C was on D2 and D1 was a pipeline-inspection table. The
number was in the evidence, so the numbers check passed it; only the source
was wrong, which is the one thing an operator cannot spot. So a sentence citing
a `D` or `G` line must find each of its measurements on one of the lines it
cites (a sensor line cited alongside counts). Small counts and the question's
own numbers are exempt, as above, and a number in no evidence at all is
already `unsupported_number`, so it is not counted twice. A label written after
the full stop belongs to the sentence before it. Its own reason,
`document_citation_mismatch`, so the evaluation counts it apart from a
mis-cited reading. A sentence with no number that cites the wrong document
still passes: that needs meaning.

## Times are moments, checked like numbers

A model can get every quantity right and misstate *when* — "the spike at
10:45" for one the evidence puts at 10:30. So every clock time and calendar
date in the answer must denote a moment written somewhere the model was shown:
the evidence (which states each one in UTC *and* site time, so either reading
matches), the question, or the replayed history. History counts here, unlike
for numbers: "the 10:30 spike you asked about" names a referent, it does not
restate a measurement. Formats are normalised (`10:30`, `10:30:00`, `10.30am`;
`2026-09-12`, `12 September`), time zones are not.

## A cause needs a source that states one

Rule 8 of the prompt says: do not claim a cause the evidence does not state.
Seen on qwen3:1.7b — the CO₂ spike "was caused by NDIR calibration", when the
cited record only listed the spike and, separately, its resolution. A
sentence making a causal claim ("because", "due to", "caused by", "led to",
Malay "disebabkan"/"kerana"/"akibat") therefore has to cite at least one
non-reading line (`D`, `G` — a sensor value cannot establish causation)
that itself uses causal language *and* shares a content word with the claim.
Sentences saying a cause is unknown or not in the evidence are exempt.

This is lexical, not semantic, and says so: a cited SOP that states *some*
cause sharing a word with the claim passes even if it is a different cause.
It closes the observed failure — a cause stitched together from lines that
state none — without pretending to read meaning.

## Rig specifics from another installation must say so

Prompt rule 9: a setpoint, limit, step, valve or sequence supported only by
another installation's documents is *general guidance*, to be confirmed against
this lab's own procedure. So a sentence that reads as rig-specific — one of
those words, a valve-style tag (`ABV-1`), or a measurement with a unit — and
cites only `D`/`G` lines marked `[REFERENCE]` fails unless the answer somewhere
says so ("general guidance", "another installation", "confirm against…").
The caveat is looked for in the whole answer, not the sentence: a model that
says it once, up front, for a list of steps has followed the rule. A sentence
citing any `[THIS RIG]` line or any reading is exempt — readings are the rig's.
Lexical, like the cause check: it catches the missing caveat, not a wrong one.

## What is tolerated, and why

- **Numbers in the question.** "Is 900 ppm high?" — echoing 900 is not a claim.
- **Small counts (0–10, no decimal point, no unit).** "Step 3", "1 record",
  "2 steps". Rejecting these made nearly every procedural answer fail in
  testing, and a count that matters (readings) is in the evidence
  anyway. A small number *with a unit* is a measurement and is checked like
  any other — "pressure is 2 bar" must be in the evidence. So the remaining
  blind spot is a small bare count, not a small value.
- **Rounding.** `540` for `539.931`. See `numbers.supported`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import numbers
from ..chat_service import REMOVED_MARK
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
    # [{"label": "D1", "number": "45°C", "sentence": "…"}] — the sentence keyed as salvage cuts it.
    mismatched_document_citations: list[dict[str, str]] = field(default_factory=list)
    cited: list[str] = field(default_factory=list)
    control_claim: str | None = None
    unsupported_times: list[str] = field(default_factory=list)
    uncited_causes: list[str] = field(default_factory=list)
    uncaveated_reference: list[str] = field(default_factory=list)

    @property
    def hallucination(self) -> bool:
        """A number, moment, cause or source the evidence cannot account for."""
        return bool(
            self.unsupported or self.stale or self.unknown_citations or self.mismatched_citations
            or self.mismatched_document_citations or self.unsupported_times or self.uncited_causes
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "reasons": self.reasons,
            "unsupported_numbers": self.unsupported,
            "stale_numbers": self.stale,
            "unknown_citations": self.unknown_citations,
            "mismatched_citations": self.mismatched_citations,
            "mismatched_document_citations": self.mismatched_document_citations,
            "cited": self.cited,
            "control_claim": self.control_claim,
            "unsupported_times": self.unsupported_times,
            "uncited_causes": self.uncited_causes,
            "uncaveated_reference": self.uncaveated_reference,
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
    history_text = "\n".join(str(h.get("content") or "") for h in (history or []))

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
    history_numbers = numbers.values(history_text)
    for n in numbers.extract(text):
        if n.decimals == 0 and n.value <= _SMALL_INT and n.unit is None:
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

    v.mismatched_document_citations = _mismatched_document_citations(text, pack, asked)
    if v.mismatched_document_citations:
        v.reasons.append("document_citation_mismatch")

    v.unsupported_times = _unsupported_moments(text, pack, question + "\n" + history_text)
    if v.unsupported_times:
        v.reasons.append("unsupported_time")

    v.uncited_causes = _uncited_causes(text, pack)
    if v.uncited_causes:
        v.reasons.append("uncited_cause")

    v.uncaveated_reference = _uncaveated_reference(text, pack)
    if v.uncaveated_reference:
        v.reasons.append("uncaveated_reference")

    v.passed = not v.reasons
    return v


_RIG_SPECIFIC_RE = re.compile(
    r"\b(?:set\s?points?|limits?|thresholds?|alarms?|interlocks?|valves?|steps?|procedures?|sequences?"
    r"|had|langkah|injap|prosedur|urutan)\b|\b[A-Z]{2,}-\d+\b",
    re.IGNORECASE,
)
_CAVEAT_RE = re.compile(
    r"\b(?:general\s+guidance|another\s+(?:installation|plant|site)|other\s+(?:installations?|plants?|sites?)"
    r"|confirm|verify|check\s+(?:it\s+|this\s+)?(?:against|with)|lab'?s\s+own|this\s+lab'?s"
    r"|panduan\s+umum|pemasangan\s+lain|sahkan)\b",
    re.IGNORECASE,
)


def _uncaveated_reference(text: str, pack: EvidencePack) -> list[str]:
    if _CAVEAT_RE.search(text):
        return []
    origin = {i.label: ("rig" if i.kind == "sensor" else i.citation.get("origin") or "reference") for i in pack.items}
    sentences = [s for s in _SENTENCE_RE.split(text) if s.strip()]
    bad: list[str] = []
    for index, sentence in enumerate(sentences):
        labels = _labels_in(sentence)
        following = sentences[index + 1] if index + 1 < len(sentences) else ""
        lead = re.match(r"\s*((?:\[[^\]]+\]\s*)+)", following)
        if lead:
            labels |= _labels_in(lead.group(1))
        known = [origin[label] for label in labels if label in origin]
        if not known or "rig" in known:
            continue
        specific = _RIG_SPECIFIC_RE.search(sentence) or any(n.unit for n in numbers.extract(sentence))
        if specific:
            bad.append(" ".join(sentence.split())[:160])
    return bad


def _unsupported_moments(text: str, pack: EvidencePack, context: str) -> list[str]:
    shown = pack.render() + "\n" + context
    known_times = {m.key for m in numbers.times(shown)}
    known_dates = {m.key for m in numbers.dates(shown)}  # type: ignore[misc]
    bad: list[str] = []
    for m in numbers.times(text):
        if m.key not in known_times and m.text not in bad:
            bad.append(m.text)
    for m in numbers.dates(text):
        if not numbers.date_supported(m, known_dates) and m.text not in bad:  # type: ignore[arg-type]
            bad.append(m.text)
    return bad


# Markers after which the *cause* is written ("X because Y"); the rest put it
# before ("Y led to X"). Only the cause's side is compared with the source, or
# the effect — which every relevant line names — would match on its own.
_CAUSE_AFTER_RE = re.compile(
    r"\b(?:because(?:\s+of)?|due\s+to|caused\s+by|as\s+a\s+result\s+of|resulted\s+from|results?\s+from"
    r"|owing\s+to|attributed\s+to|attributable\s+to|triggered\s+by|stems?\s+from|disebabkan(?:\s+oleh)?"
    r"|kerana|akibat)\b",
    re.IGNORECASE,
)
_CAUSE_BEFORE_RE = re.compile(
    r"\b(?:led\s+to|leads?\s+to|leading\s+to|resulted\s+in|results?\s+in|causes|caused|causing|menyebabkan)\b",
    re.IGNORECASE,
)
_CAUSAL_RE = re.compile(
    r"\b(?:because|due\s+to|caused\s+by|causes?|caused|causing|as\s+a\s+result\s+of|resulted\s+(?:in|from)"
    r"|results?\s+(?:in|from)|led\s+to|leads?\s+to|leading\s+to|owing\s+to|attributed\s+to|attributable\s+to"
    r"|triggered\s+by|stems?\s+from|root\s+cause|disebabkan|kerana|akibat|punca|menyebabkan)\b",
    re.IGNORECASE,
)
# A sentence *about* the absence of a cause is the answer rule 4 asks for, not a claim.
_NO_CAUSE_RE = re.compile(
    r"\b(?:not|no|unknown|unclear|cannot|can't|isn't|doesn't|does\s+not|do\s+not|without|neither|nor"
    r"|tidak|bukan|tiada)\b",
    re.IGNORECASE,
)
_STOPWORDS = frozenset(
    "the a an and or of to in on at by for from with was were is are be been being this that these those "
    "it its as into than then there their which who what when where why how may might could would should "
    "can will due because caused cause causes causing result resulted results led lead leads leading owing "
    "attributed attributable triggered stem stems from root reactor reading readings value level high low "
    "during after before about also".split()
)


def _content_words(text: str) -> set[str]:
    words = re.findall(r"[a-z][a-z0-9₂]+", _CITATION_RE.sub(" ", text.lower()))
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}


def _uncited_causes(text: str, pack: EvidencePack) -> list[str]:
    lines = {i.label: (i.kind, i.line) for i in pack.items}
    sentences = [s for s in _SENTENCE_RE.split(text) if s.strip()]
    bad: list[str] = []
    for index, sentence in enumerate(sentences):
        if not _CAUSAL_RE.search(sentence) or _NO_CAUSE_RE.search(sentence):
            continue
        labels = _labels_in(sentence)
        # A label written after the full stop belongs to this sentence.
        following = sentences[index + 1] if index + 1 < len(sentences) else ""
        lead = re.match(r"\s*((?:\[[^\]]+\]\s*)+)", following)
        if lead:
            labels |= _labels_in(lead.group(1))
        claim = _cause_side(sentence)
        sources = [lines[label][1] for label in labels if label in lines and lines[label][0] != "sensor"]
        if not any(_CAUSAL_RE.search(line) and claim & _content_words(line) for line in sources):
            bad.append(" ".join(sentence.split())[:160])
    return bad


def _cause_side(sentence: str) -> set[str]:
    after = _CAUSE_AFTER_RE.search(sentence)
    if after:
        return _content_words(sentence[after.end():]) or _content_words(sentence)
    before = _CAUSE_BEFORE_RE.search(sentence)
    if before:
        return _content_words(sentence[:before.start()]) or _content_words(sentence)
    return _content_words(sentence)


def _labels_in(text: str) -> set[str]:
    return {
        label.strip() for group in _CITATION_RE.findall(text) for label in re.split(r"[,;]", group)
    }


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_MODES = ("manual", "absorption", "desorption")


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
    if "stale" in shown and ("stale" in said or " old" in said or "days ago" in said):
        return True
    if "frozen" in shown and any(w in said for w in ("frozen", "stopped", "unchanged", "not changed", "stuck")):
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


def _key(sentence: str) -> str:
    """A sentence as salvage matches it: whitespace collapsed, first 160 characters."""
    return " ".join(sentence.split())[:160]


def _mismatched_document_citations(text: str, pack: EvidencePack, asked: set[float]) -> list[dict[str, str]]:
    lines = {i.label: i.line for i in pack.items}
    prose = {i.label for i in pack.items if i.kind in ("document", "graph")}
    if not prose:
        return []
    sentences = [s for s in _SENTENCE_RE.split(text) if s.strip()]
    bad: list[dict[str, str]] = []
    for index, sentence in enumerate(sentences):
        labels = sorted({
            label.strip() for group in _CITATION_RE.findall(sentence)
            for label in re.split(r"[,;]", group)
        } & lines.keys())
        if not set(labels) & prose:
            continue
        claim = sentence
        # "… drained. [D3]": the label stands alone, so its claim is the sentence before.
        if not numbers.extract(sentence) and index and not _CITATION_RE.search(sentences[index - 1]):
            claim = sentences[index - 1]
        cited_values = numbers.values(" ".join(lines[label] for label in labels))
        for n in numbers.extract(claim):
            if n.decimals == 0 and n.value <= _SMALL_INT and n.unit is None:
                continue
            if n.value in asked or not numbers.supported(n, pack.numbers):
                continue  # exempt, or already an unsupported/stale number
            if not numbers.supported(n, cited_values):
                bad.append({"label": ", ".join(lb for lb in labels if lb in prose),
                            "number": n.text, "sentence": _key(claim)})
    return bad


# Ended trimmed answers before the in-place marker (2026-11-11); kept so old
# rows still read correctly.
TRIMMED_NOTE = "\n\n_Part of this answer was removed: it was not supported by the evidence._"


# What is left of a line once its only statement is cut: a list marker,
# citation labels, markdown emphasis and punctuation, and nothing that says anything.
_HOLLOW = re.compile(r"\s*(?:[-*+]|\d+[.)])?\s*(?:\[[^\]]*\]|[*_`:;,.\s])*")


def salvage(
    answer: str,
    v: Validation,
    pack: EvidencePack,
    *,
    question: str = "",
    history: list[dict[str, Any]] | None = None,
) -> str | None:
    """Cut what failed instead of the whole answer; `None` when the rest still fails.

    A bad value inside brackets loses the brackets ("31.74 °C (about 88.1 °F)"),
    otherwise its sentence goes; an uncited cause loses its sentence; an unknown
    label is dropped. The remainder is validated again, so nothing here can let
    a failure through, and a cited answer left with no citation is not kept.
    A control claim is never trimmed: an answer that says it
    acted on the rig is not trusted for the rest either.
    """
    if v.control_claim:
        return None
    bad = v.unsupported + v.stale + v.unsupported_times
    causes = set(v.uncited_causes) | {m["sentence"] for m in v.mismatched_document_citations}

    def dirty(sentence: str) -> bool:
        return any(b in sentence for b in bad) or _key(sentence) in causes

    # A cut leaves REMOVED_MARK where the text was, so the operator sees that
    # something went and where, without reading it.
    text = re.sub(r"\s*\([^()]*\)", lambda m: f" {REMOVED_MARK}" if dirty(m.group()) else m.group(), answer)
    text = _CITATION_RE.sub(
        lambda m: (lambda keep: f"[{', '.join(keep)}]" if keep else "")(
            [x.strip() for x in re.split(r"[,;]", m.group(1)) if x.strip() in pack.labels]
        ),
        text,
    )
    lines = []
    for line in text.split("\n"):
        sentences = re.split(r"(?<=[.!?])\s+", line)
        out: list[str] = []
        cut = False
        for sentence in sentences:
            if dirty(sentence):
                if not out or out[-1] != REMOVED_MARK:
                    out.append(REMOVED_MARK)
                cut = True
            # A label written after the full stop ("… drained. [D3]") went with its sentence.
            elif cut and out and out[-1] == REMOVED_MARK and _HOLLOW.fullmatch(sentence):
                continue
            else:
                out.append(sentence)
        # A list item's marker ("2.") splits off as a sentence of its own. Once
        # the sentence after it is cut, the item is the marker alone: "2. ⟦removed⟧",
        # never "2. [D3]" (seen 2026-11-11).
        if cut and _HOLLOW.fullmatch(" ".join(o for o in out if o != REMOVED_MARK)):
            bullet = re.match(r"\s*(?:[-*+]|\d+[.)])\s", line)
            out = [*([bullet.group().strip()] if bullet else []), REMOVED_MARK]
        if out or not line.strip():
            lines.append(" ".join(out))
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if not text or text == answer.strip():
        return None
    # A cited answer cut down to no citations is the connective tissue around
    # claims that are gone ("These conditions ensure the reactor is safely
    # drained", 2026-11-11). The fallback says that more honestly.
    if v.cited and not _CITATION_RE.search(text):
        return None
    if not validate(text, pack, question=question, history=history).passed:
        return None
    return text


def grounded(v: Validation, pack: EvidencePack) -> bool:
    """Passed, had evidence, and cited some of it — what `grounded_flag` records."""
    return v.passed and not pack.empty and bool(set(v.cited) & pack.labels)
