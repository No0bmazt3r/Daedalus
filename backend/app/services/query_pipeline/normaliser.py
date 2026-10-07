"""Step 2 of PROJECT.md §7.1: normalise the query.

Deterministic, instant, and run on every message before anything else sees it.
It produces two forms of the same text:

| form | what it is for |
|---|---|
| `text` | the question as the operator meant it: trimmed, whitespace collapsed, invisible characters gone, original casing kept. What the model is shown. |
| `match` | `text` NFKC-folded and lower-cased, for every pattern in `vocabulary`. `CO₂` becomes `co2` here, so no pattern has to spell both. |

It also rejects what should never reach a model at all — an empty message, or
one too long to be a question (`MAX_QUERY_CHARS`) — and flags the language, so
a Malay question is recorded as one rather than silently misread.

Control keywords are *not* judged here. §7.1 lists "detect control keywords" in
this step, and they are detected — but the decision belongs to the safety
guard, which needs clause structure to tell "how do I open ABV-1?" from "open
ABV-1". Deciding it twice in two places would let them disagree.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from . import vocabulary as vocab

# Past this a message is a pasted document, not a question. It would also eat
# most of an SLM's context before any evidence arrived. Generous on purpose: a
# long, careful question should never trip it.
MAX_QUERY_CHARS = 2000

# Zero-width and bidi-control characters. Invisible in the composer, they can
# split a keyword so a pattern misses it — "op​en ABV-1" reads as "open
# ABV-1" to a person and as two words to a regex.
_INVISIBLE_RE = re.compile("[­​-‏‪-‮⁠-⁤﻿]")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SPACE_RE = re.compile(r"\s+")

_PUNCT_FOLD = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"',
    "–": "-", "—": "-", "−": "-",
    "´": "'", "ʼ": "'",
})

# An address to the assistant carries no meaning for classification.
_ADDRESS_RE = re.compile(r"^(?:hey\s+|hi\s+|ok\s+)?daedalus[\s,:!]+")


@dataclass(frozen=True)
class NormalisedQuery:
    text: str
    match: str
    #: None, or why the message cannot be answered: 'empty' | 'too_long'.
    problem: str | None
    #: 'en' | 'ms' | 'mixed' — a flag, not a refusal. Downstream may answer in kind.
    language: str
    #: Raw length before cleaning, for the too-long reply.
    length: int


def _language(match: str) -> str:
    words = re.findall(r"[a-z]+", match)
    if not words:
        return "en"
    malay = len(vocab.MALAY_RE.findall(match))
    share = malay / len(words)
    if share >= 0.4:
        return "ms"
    if malay >= 2:
        return "mixed"
    return "en"


def normalise(raw: str) -> NormalisedQuery:
    length = len(raw)
    text = unicodedata.normalize("NFKC", raw)
    text = _INVISIBLE_RE.sub("", text)
    text = _CONTROL_RE.sub(" ", text)
    text = text.translate(_PUNCT_FOLD)
    text = _SPACE_RE.sub(" ", text).strip()

    match = _ADDRESS_RE.sub("", text.lower()).strip()

    problem = None
    if not text:
        problem = "empty"
    elif len(text) > MAX_QUERY_CHARS:
        problem = "too_long"

    return NormalisedQuery(
        text=text,
        match=match,
        problem=problem,
        language=_language(match),
        length=length,
    )
