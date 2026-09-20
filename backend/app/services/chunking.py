"""Splitting extracted text into the units that get embedded — M2, step 4.

`architecture/04` Step 4 asks for 300-500 token chunks with overlap. This module
is that, made adjustable and made inspectable, because the chunk size is one of
the few knobs in this system whose effect on retrieval quality is large, obvious
and impossible to reason about from a number alone.

## Why chunking is its own module, with no I/O

Every function here is pure: text in, chunks out, no database, no vector store,
no config read. That is what lets the UI preview a settings change against a
real document without ingesting anything — the expensive part of an ingest is
embedding, and a question about where the splits land should not cost an
embedding run. It is also what makes the behaviour testable without a fixture
database.

## The strategies, and when each is wrong

| Strategy | Splits on | Fails when |
|---|---|---|
| `recursive` | paragraph → line → sentence → word, in that order | Nothing much. The default |
| `paragraph` | blank lines only | One 4000-character paragraph becomes one 4000-character chunk |
| `fixed` | character count, ignoring structure | Always splits mid-sentence; included as the honest baseline |

`recursive` is the default because it degrades: it tries to break at a paragraph,
and only if the resulting piece is still too big does it look for a line break,
then a sentence end, then a space. A split that lands mid-sentence is the last
resort rather than the first behaviour.

`fixed` exists because the comparison chapter may want it. A retrieval result
that improves when you switch away from `fixed` is evidence that structure-aware
chunking mattered; without the bad option in the tool there is no such evidence.

## Tokens are estimated, and say so

Chunk sizes here are in **characters**, not tokens, and `token_estimate` is
`chars / 4` rounded — the standard rough ratio for English. Counting real tokens
would mean loading the embedding model's tokenizer, which means the chunker
could not run without the model pulled, which would break preview on a fresh
install. The estimate is labelled an estimate everywhere it surfaces, per
`MODULES.md` §2.2: an estimate and a measurement must never look alike.

What this means in practice: `architecture/04`'s 300-500 *tokens* is roughly
1200-2000 *characters*, which is where `DEFAULT_CHUNK_SIZE` sits.

## Overlap is a floor on context, not a duplicate

Each chunk after the first begins up to `overlap` characters before the previous
one ended, so a sentence spanning a boundary survives in at least one chunk
whole. Two consequences worth stating rather than discovering:

- **A chunk can exceed `chunk_size` by up to `overlap`.** The overlap is added
  after splitting, so a 1500/200 setting produces chunks up to 1700 characters.
  Sized against an embedder's context window that is immaterial — the smallest
  in the catalogue holds 512 tokens, about 2000 characters — but the number in
  the preview is the real one and is not clipped to look tidy.
- **The cost is real.** At 1500/200 roughly 13% of the corpus is embedded twice:
  13% more vectors, 13% more index, and a small bias toward boundary text in
  results.

The backtrack snaps forward to the next word boundary. Slicing at a raw
character offset starts chunks mid-word — `ee are read-only windows` — and that
fragment is not free: it is a token the embedder has to account for, it appears
in every quoted excerpt, and it makes a chunk look corrupted to anybody reading
the pipeline output to check it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

Strategy = Literal["recursive", "paragraph", "fixed"]

STRATEGIES: tuple[Strategy, ...] = ("recursive", "paragraph", "fixed")

# ~375 tokens at 4 chars/token, inside architecture/04's 300-500 band.
DEFAULT_CHUNK_SIZE = 1500
DEFAULT_OVERLAP = 200
DEFAULT_STRATEGY: Strategy = "recursive"

# Bounds, enforced here rather than at the API so a scripted run cannot bypass
# them. The floor is not arbitrary: below ~200 characters a chunk is a fragment
# whose embedding is dominated by whatever words happen to be in it, and
# retrieval starts returning sentence shards that cite nothing usefully.
MIN_CHUNK_SIZE = 200
MAX_CHUNK_SIZE = 8000

# Where `recursive` tries to break, best first. Each is a regex and what to keep.
_SEPARATORS: tuple[str, ...] = (
    r"\n\s*\n",   # paragraph
    r"\n",        # line
    r"(?<=[.!?])\s+",  # sentence end
    r"\s+",       # word
)

_HEADING = re.compile(
    r"^\s{0,3}(?:#{1,6}\s+(?P<hash>.+)"          # markdown ATX
    r"|(?P<num>\d+(?:\.\d+)*\.?\s+[A-Z].{0,80})"  # "4.2 Shutdown Procedure"
    r"|(?P<caps>[A-Z][A-Z0-9 \-/&]{6,80}))\s*$",  # SHOUTED HEADING
    re.MULTILINE,
)


class ChunkingError(ValueError):
    """The requested chunk settings cannot produce chunks."""


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    text: str
    char_start: int
    char_end: int
    page_number: int | None
    section_title: str | None

    @property
    def token_estimate(self) -> int:
        """Characters ÷ 4. An estimate, and named one everywhere it is shown."""
        return max(1, round(len(self.text) / 4))

    def as_dict(self) -> dict[str, Any]:
        return {
            "ordinal": self.ordinal,
            "text": self.text,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "token_estimate": self.token_estimate,
            "page_number": self.page_number,
            "section_title": self.section_title,
        }


def validate(size: int, overlap: int, strategy: str) -> tuple[int, int, Strategy]:
    """Coerce and check settings, or raise with a reason a person can act on.

    Overlap ≥ size is the one that actually happens — it is an easy thing to type
    and it does not fail loudly, it makes the splitter step backwards forever.
    Caught here rather than defended against in the loop, so the error names the
    mistake instead of the symptom.
    """
    if strategy not in STRATEGIES:
        raise ChunkingError(f"unknown strategy {strategy!r}; expected one of {', '.join(STRATEGIES)}")
    size = int(size)
    overlap = int(overlap)
    if not MIN_CHUNK_SIZE <= size <= MAX_CHUNK_SIZE:
        raise ChunkingError(
            f"chunk size must be between {MIN_CHUNK_SIZE} and {MAX_CHUNK_SIZE} characters, got {size}"
        )
    if overlap < 0:
        raise ChunkingError(f"overlap cannot be negative, got {overlap}")
    if overlap >= size:
        raise ChunkingError(
            f"overlap ({overlap}) must be smaller than the chunk size ({size}) — "
            "an overlap at or above the size means each chunk starts at or before the "
            "previous one did, and the splitter never advances."
        )
    return size, overlap, strategy  # type: ignore[return-value]


def _headings(text: str) -> list[tuple[int, str]]:
    """Every heading's offset and title, so a chunk can say what section it is in.

    Best-effort and structural only: three shapes of heading, no semantics. A
    chunk inherits the last heading that started at or before it, which is wrong
    for a chunk that spans a boundary — it is labelled with where it *began*,
    which is the more useful of the two available answers.
    """
    found = []
    for match in _HEADING.finditer(text):
        title = match.group("hash") or match.group("num") or match.group("caps")
        if title:
            found.append((match.start(), title.strip()))
    return found


def _section_at(headings: list[tuple[int, str]], offset: int) -> str | None:
    title = None
    for start, name in headings:
        if start > offset:
            break
        title = name
    return title


def _page_at(page_breaks: list[int], offset: int) -> int | None:
    """1-based page for an offset, given each page's start offset."""
    if not page_breaks:
        return None
    page = 1
    for index, start in enumerate(page_breaks):
        if start > offset:
            break
        page = index + 1
    return page


def _split_recursive(text: str, size: int) -> list[tuple[int, str]]:
    """Pieces no larger than `size`, broken at the best available boundary.

    Returns offsets alongside the text because a chunk that cannot say where it
    came from cannot be shown in context or cited to a position.
    """
    pieces: list[tuple[int, str]] = []

    def divide(segment: str, base: int, depth: int) -> None:
        if len(segment) <= size:
            if segment.strip():
                pieces.append((base, segment))
            return
        if depth >= len(_SEPARATORS):
            # Out of separators: a run of `size` characters with no whitespace at
            # all, which is a table, a base64 blob or a hash. Cut it flat rather
            # than emit something over the limit the embedder would truncate.
            for offset in range(0, len(segment), size):
                part = segment[offset:offset + size]
                if part.strip():
                    pieces.append((base + offset, part))
            return

        parts: list[tuple[int, str]] = []
        cursor = 0
        for match in re.finditer(_SEPARATORS[depth], segment):
            parts.append((cursor, segment[cursor:match.start()]))
            cursor = match.end()
        parts.append((cursor, segment[cursor:]))

        # Re-join neighbours that fit together. Splitting on paragraphs and
        # emitting each one is not chunking — it produces a 40-character chunk
        # for a one-line paragraph and wastes most of the budget.
        buffer, buffer_base = "", -1
        for offset, part in parts:
            if not part.strip():
                continue
            candidate = part if not buffer else f"{buffer}\n{part}"
            if len(candidate) <= size:
                buffer, buffer_base = candidate, (buffer_base if buffer else base + offset)
                continue
            if buffer:
                pieces.append((buffer_base, buffer))
            if len(part) <= size:
                buffer, buffer_base = part, base + offset
            else:
                buffer, buffer_base = "", -1
                divide(part, base + offset, depth + 1)
        if buffer:
            pieces.append((buffer_base, buffer))

    divide(text, 0, 0)
    return pieces


def _split_paragraph(text: str, size: int) -> list[tuple[int, str]]:
    """Blank lines only. Oversized paragraphs are left oversized, on purpose.

    The strategy's whole claim is "never break a paragraph", so silently breaking
    one would make it a worse `recursive` wearing its name. A document that
    produces a 6000-character chunk here is telling you this is the wrong
    strategy for it, and the chunk list shows that plainly.
    """
    pieces: list[tuple[int, str]] = []
    cursor = 0
    for match in re.finditer(r"\n\s*\n", text):
        part = text[cursor:match.start()]
        if part.strip():
            pieces.append((cursor, part))
        cursor = match.end()
    tail = text[cursor:]
    if tail.strip():
        pieces.append((cursor, tail))
    return pieces


def _split_fixed(text: str, size: int, overlap: int) -> list[tuple[int, str]]:
    """Character count, structure ignored. The baseline, deliberately naive."""
    pieces: list[tuple[int, str]] = []
    step = size - overlap
    for offset in range(0, len(text), step):
        part = text[offset:offset + size]
        if part.strip():
            pieces.append((offset, part))
        if offset + size >= len(text):
            break
    return pieces


def _with_overlap(pieces: list[tuple[int, str]], text: str, overlap: int) -> list[tuple[int, str]]:
    """Extend each piece backwards so boundaries are covered twice.

    Applied after splitting rather than during it, so the strategies stay simple
    and overlap means the same thing for all of them. `fixed` does its own,
    because stepping is how it splits at all.
    """
    if overlap <= 0:
        return pieces
    out = []
    for index, (start, body) in enumerate(pieces):
        if index == 0:
            out.append((start, body))
            continue
        back = _word_boundary(text, max(0, start - overlap), start)
        out.append((back, text[back:start] + body))
    return out


def _word_boundary(text: str, back: int, limit: int) -> int:
    """Move `back` forward to the start of a word, or leave it where it is.

    Forward rather than backward, so the overlap only ever shrinks: growing it
    to reach an earlier boundary could walk past the previous chunk's start and
    duplicate more than was asked for. If there is no whitespace between `back`
    and `limit` — one very long token — the offset stands, because a boundary
    that does not exist cannot be snapped to.
    """
    if back == 0 or back >= limit:
        return back
    space = text.find(" ", back, limit)
    newline = text.find("\n", back, limit)
    candidates = [i for i in (space, newline) if i != -1]
    return min(candidates) + 1 if candidates else back


def chunk_text(
    text: str,
    *,
    size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
    strategy: str = DEFAULT_STRATEGY,
    page_breaks: list[int] | None = None,
) -> list[Chunk]:
    """Split extracted text. The one entry point; everything above is private.

    `page_breaks` is each page's start offset in `text`, from the extractor. A
    chunk is tagged with the page its *first* character is on — spanning chunks
    exist and pretending otherwise would put a citation on the wrong page.
    """
    size, overlap, strategy = validate(size, overlap, strategy)
    if not text or not text.strip():
        return []

    if strategy == "fixed":
        pieces = _split_fixed(text, size, overlap)
    elif strategy == "paragraph":
        pieces = _with_overlap(_split_paragraph(text, size), text, overlap)
    else:
        pieces = _with_overlap(_split_recursive(text, size), text, overlap)

    headings = _headings(text)
    breaks = page_breaks or []
    chunks = []
    for ordinal, (start, body) in enumerate(pieces):
        stripped = body.strip()
        if not stripped:
            continue
        # The offsets describe the trimmed text, not the raw slice, so a chunk's
        # char_start points at its first real character.
        lead = len(body) - len(body.lstrip())
        begin = start + lead
        chunks.append(
            Chunk(
                ordinal=len(chunks),
                text=stripped,
                char_start=begin,
                char_end=begin + len(stripped),
                page_number=_page_at(breaks, begin),
                section_title=_section_at(headings, begin),
            )
        )
    return chunks


def describe() -> dict[str, Any]:
    """The knobs and their bounds, for the settings UI to render from."""
    return {
        "strategies": [
            {
                "id": "recursive",
                "label": "Recursive",
                "hint": "Paragraph, then line, then sentence, then word. Breaks mid-sentence only as a last resort.",
                "recommended": True,
            },
            {
                "id": "paragraph",
                "label": "Paragraph",
                "hint": "Blank lines only. Never breaks a paragraph — so a long one becomes one long chunk.",
                "recommended": False,
            },
            {
                "id": "fixed",
                "label": "Fixed size",
                "hint": "Character count, structure ignored. The naive baseline, kept so the comparison has one.",
                "recommended": False,
            },
        ],
        "defaults": {
            "strategy": DEFAULT_STRATEGY,
            "chunk_size": DEFAULT_CHUNK_SIZE,
            "chunk_overlap": DEFAULT_OVERLAP,
        },
        "bounds": {
            "chunk_size": {"min": MIN_CHUNK_SIZE, "max": MAX_CHUNK_SIZE},
            "chunk_overlap": {"min": 0, "max": MAX_CHUNK_SIZE - 1},
        },
        "note": (
            "Sizes are characters. Tokens are estimated at 4 characters each and labelled "
            "as estimates — counting real tokens would need the embedding model's tokenizer, "
            "which would stop preview working before a model is pulled."
        ),
    }
