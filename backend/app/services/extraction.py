"""Uploaded bytes to text, with the page offsets a citation needs — M2, step 3.

`architecture/04` Steps 1-3: take a document, get its text, keep enough
structure that a retrieved chunk can point back at a page. This module is the
narrow part of that — bytes in, text and page boundaries out — and it is
deliberately separate from chunking and from ingestion so that a parser problem
is diagnosable as a parser problem.

## What it can read, and what it says when it cannot

| Type | Reader | Needs |
|---|---|---|
| `.txt` `.md` `.csv` `.json` `.yaml` | built-in | nothing |
| `.pdf` | `pypdf` | the package, which is optional |
| PDF tables | `pdfplumber`, added as Markdown rows after the page's text | optional too; without it tables stay as pypdf's run-on cells |

PDF support is an **optional import**, the same discipline `vector_store` uses
for Chroma and `hardware` for `pynvml`. A machine without `pypdf` must still
boot, still accept text documents and still say precisely why a PDF was
refused — rather than failing at import and taking the whole API down, or
accepting the upload and producing an empty document that looks ingested.

There is no OCR. A scanned PDF has no text layer, so `pypdf` returns almost
nothing, and this reports that as a failure with the page count it did find
rather than storing a document whose chunks are all whitespace. Silent success
on an empty extraction is the worst outcome available here: it produces a
document that is in the corpus, has zero useful chunks, and will never match a
query — and nothing on screen says why.

## Page offsets, and why they are offsets

Pages are recorded as the character offset where each begins in the extracted
text, not as a per-page list of strings. The chunker works over one continuous
string — a chunk may legitimately span a page break — so a chunk's page is
looked up by offset. Splitting into a list of pages would force the chunker to
choose between respecting page boundaries and respecting semantic ones, and page
boundaries in a manual are an artefact of typesetting.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

# Extensions we will attempt, mapped to the media type recorded on the document.
TEXT_TYPES: dict[str, str] = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".yaml": "application/x-yaml",
    ".yml": "application/x-yaml",
    ".log": "text/plain",
    ".rst": "text/x-rst",
}

PDF_TYPES: dict[str, str] = {".pdf": "application/pdf"}

SUPPORTED = {**TEXT_TYPES, **PDF_TYPES}

# Below this, an extraction that "succeeded" almost certainly did not. The
# number is a judgement: a real SOP page carries hundreds of characters, and a
# scanned one carries a handful of stray ligatures the text layer picked up.
_EMPTY_THRESHOLD = 32


class ExtractionError(RuntimeError):
    """The bytes could not be turned into text, with a reason worth showing."""


@dataclass
class Extracted:
    text: str
    # Character offset in `text` where each page begins. Empty for formats with
    # no pages, which is most of them, and the chunker treats that as "unknown"
    # rather than as "page 1".
    page_breaks: list[int] = field(default_factory=list)
    page_count: int | None = None
    extractor: str = "text"
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "chars": len(self.text),
            "page_count": self.page_count,
            "extractor": self.extractor,
            "warnings": self.warnings,
        }


def supported_extensions() -> list[str]:
    return sorted(SUPPORTED)


def media_type_for(filename: str) -> str:
    return SUPPORTED.get(_suffix(filename), "application/octet-stream")


def _suffix(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot >= 0 else ""


def pdf_available() -> tuple[bool, str]:
    """Whether PDFs can be read here, and what to say when they cannot."""
    try:
        import pypdf  # noqa: PLC0415, F401 — optional dependency, probed on demand
    except ImportError:
        return False, (
            "PDF support needs the `pypdf` package, which is not installed in this "
            "environment. It is listed in backend/requirements.txt; run `./sync.sh` (or "
            "`pip install -r requirements.txt` in backend/) to install it. Text and Markdown documents work without it."
        )
    return True, ""


# Some PDFs (the Fuji ZRE manual is one) embed fonts whose character codes are
# shifted 29 below the real letters and carry no map back to Unicode, so pypdf
# reads "the" as "WKH" and a space as the control character 0x03. The shift is
# fixed, and the 0x03 "space" marks exactly which runs are encoded this way,
# so those runs are decoded and the rest of the page is left alone. Matched
# with an explicit whitespace class: Python's \s counts 0x1c-0x1f as spaces,
# and 0x1f here is an encoded "<".
_SHIFT = 29
_SHIFTED_RUN = re.compile(r"[^ \t\n\r\x03]*(?:\x03+[^ \t\n\r\x03]*)+")


def _unshift(text: str) -> str:
    """Decode the font-shifted runs in one page's text. Same length out as in."""
    if "\x03" not in text:
        return text
    return _SHIFTED_RUN.sub(
        lambda m: "".join(chr(ord(c) + _SHIFT) if 0 < ord(c) < 0x7F - _SHIFT else c for c in m.group(0)),
        text,
    )


# A word on a font-shifted page with no space in it carries no 0x03 marker, so
# `_unshift` cannot see it — section titles are the usual case ("FDOLEUDWLRQ" for
# "calibration"). Such a word is decoded only when decoding makes it markedly
# more like English by letter frequency, so a real capitalised word ("CAUTION",
# "ZERO") on the same page is left alone.
_SHIFTED_WORD = re.compile(r"(?<![^\s(])[$-\]]{5,}(?![^\s).,:;])")
_LETTER_FREQ = dict(zip(
    "etaoinshrdlcumwfgypbvkjxqz",
    (12.7, 9.1, 8.2, 7.5, 7.0, 6.7, 6.3, 6.1, 6.0, 4.3, 4.0, 2.8, 2.8, 2.4, 2.4, 2.2, 2.0, 2.0,
     1.9, 1.5, 1.0, 0.8, 0.15, 0.15, 0.1, 0.07),
))


def _englishness(word: str) -> float:
    letters = [c for c in word.lower() if c.isalpha()]
    if not letters:
        return -99.0
    return sum(math.log(_LETTER_FREQ.get(c, 0.05)) for c in letters) / len(letters)


def _unshift_words(text: str) -> str:
    def fix(m: re.Match[str]) -> str:
        word = m.group(0)
        decoded = "".join(chr(ord(c) + _SHIFT) for c in word)
        if not decoded[1:].isalpha() or not decoded[1:].islower():
            return word
        return decoded if _englishness(decoded) - _englishness(word) > 0.4 else word
    return _SHIFTED_WORD.sub(fix, text)


# Repeated page furniture: the same header or footer line on most pages, and
# bare page numbers. Compared with digits folded, since "Page 3 of 13" differs
# on every page. Only lines near the top or bottom of a page are candidates.
_EDGE_LINES = 2
_PAGE_NUMBER = re.compile(r"^\s*(?:page\s*)?\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?\s*$", re.IGNORECASE)
# A contents page: dot leaders, or "contents" with most lines ending in a page number.
_DOT_LEADER = re.compile(r"(?:\.\s?){4,}\s*\d{1,4}\s*$")
_ENDS_IN_NUMBER = re.compile(r"\s\d{1,4}\s*$")


def _fold(line: str) -> str:
    return re.sub(r"\d+", "#", " ".join(line.split()).lower())


def _strip_furniture(pages: list[str]) -> tuple[list[str], int]:
    """Drop repeated headers/footers and bare page numbers. Returns the pages and lines dropped."""
    counts: dict[str, int] = {}
    for page in pages:
        lines = [line for line in page.split("\n") if line.strip()]
        for line in {_fold(x) for x in lines[:_EDGE_LINES] + lines[-_EDGE_LINES:]}:
            counts[line] = counts.get(line, 0) + 1
    read = sum(1 for page in pages if page.strip())
    repeated = {line for line, n in counts.items() if read >= 4 and n >= read / 2 and len(line) > 3}
    dropped = 0
    out = []
    for page in pages:
        lines = page.split("\n")
        real = [i for i, line in enumerate(lines) if line.strip()]
        edge = set(real[:_EDGE_LINES] + real[-_EDGE_LINES:])
        kept = []
        for i, line in enumerate(lines):
            if i in edge and (_fold(line) in repeated or _PAGE_NUMBER.match(line)):
                dropped += 1
                continue
            kept.append(line)
        out.append("\n".join(kept).strip())
    return out, dropped


def _is_contents(page: str) -> bool:
    lines = [line for line in page.split("\n") if line.strip()]
    if len(lines) < 5:
        return False
    leaders = sum(bool(_DOT_LEADER.search(line)) for line in lines)
    numbered = sum(bool(_ENDS_IN_NUMBER.search(line)) for line in lines)
    return leaders >= len(lines) * 0.4 or ("contents" in page.lower() and numbered >= len(lines) * 0.5)


# pdfminer writes a glyph with no Unicode mapping as "(cid:N)". In the
# font-shifted manuals N is the same shifted code pypdf returns as a character,
# so turning it back into that character lets `_unshift` decode both alike.
_CID = re.compile(r"\(cid:(\d+)\)")


def _cell(value: Any) -> str:
    text = _CID.sub(lambda m: chr(int(m.group(1))) if int(m.group(1)) < 0x110000 else "", str(value or ""))
    # Explicit whitespace class, as in `_SHIFTED_RUN`: \s would eat 0x1c-0x1f,
    # which are shifted letters here.
    return re.sub(r"[ \t\n\r]+", " ", text).strip().replace("|", "/")


def _tables(raw: bytes, wanted: list[int], fix: Any) -> tuple[dict[int, list[str]], str | None]:
    """Each wanted page's tables as Markdown, by 1-based page number.

    pypdf reads a table as a run of cells with the rows and columns lost — "Span
    gas 400 ppm Zero gas N2 0" — so a limit and the thing it limits end up
    unrelated. pdfplumber finds the ruling lines and keeps each row whole, and
    a Markdown row is what both the embedder and BM25 can match as one fact.

    Added *alongside* pypdf's text, not instead of it: pypdf is what decodes the
    AES-locked and font-shifted manuals, and a table pdfplumber mis-detects
    costs a few duplicated cells rather than lost text. `fix` is the same
    font-shift decoding pypdf's text got. Optional, like pypdf: without the
    package, or on a file it cannot open, the document still ingests and the
    second value says why there are no tables.
    """
    try:
        import pdfplumber  # noqa: PLC0415 — optional dependency, probed on demand
    except ImportError:
        return {}, "tables not extracted: pdfplumber is not installed"
    import io as _io  # noqa: PLC0415
    import logging  # noqa: PLC0415

    # pdfminer logs a warning per odd font ("fontTools is required …") — dozens
    # per manual, none actionable, all drowning the ingest log.
    logging.getLogger("pdfminer").setLevel(logging.ERROR)
    found: dict[int, list[str]] = {}
    try:
        with pdfplumber.open(_io.BytesIO(raw), password="") as pdf:
            for number in wanted:
                try:
                    tables = pdf.pages[number - 1].extract_tables()
                except Exception:  # noqa: BLE001 — one bad page is not a bad document
                    continue
                for table in tables:
                    rows = [[fix(_cell(c)) for c in row] for row in table if any(c for c in row)]
                    # Still holding control characters after decoding: an
                    # unmapped font that is not the known shift. Unreadable.
                    if any(ch < " " for r in rows for c in r for ch in c):
                        continue
                    # A 1-column or 1-row "table" is a ruled box around prose.
                    if len(rows) < 2 or max(len(r) for r in rows) < 2:
                        continue
                    width = max(len(r) for r in rows)
                    rows = [r + [""] * (width - len(r)) for r in rows]
                    lines = ["| " + " | ".join(rows[0]) + " |", "|" + " --- |" * width]
                    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
                    found.setdefault(number, []).append("\n".join(lines))
    except Exception as exc:  # noqa: BLE001 — tables are a bonus; the text is already read
        return {}, f"tables not extracted: pdfplumber could not open this file ({exc})"
    return found, None


def _normalise(text: str) -> str:
    """Line endings, and the ligatures a PDF text layer leaves behind.

    Done here rather than in the chunker because it changes offsets, and every
    offset this module reports has to describe the string it returns.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Control characters other than newline and tab are font debris (list
    # markers, unmapped glyphs), never text anyone wrote.
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    for bad, good in (("ﬁ", "fi"), ("ﬂ", "fl"), (" ", " "), ("’", "'")):
        text = text.replace(bad, good)
    # Some manuals map the fi/fl ligatures to ¿ and À (the Fuji ZRE: "¿re",
    # "Àow"). Only before a lower-case letter, where neither is plausible text.
    text = re.sub(r"¿(?=[a-z])", "fi", text)
    text = re.sub(r"À(?=[a-z])", "fl", text)
    # Three or more blank lines carry no information the chunker can use and
    # inflate every offset after them.
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _decode(raw: bytes) -> str:
    """UTF-8, then Latin-1 as the fallback that cannot fail.

    Latin-1 maps every byte to a character, so this never raises — a file in an
    unknown encoding produces mojibake rather than an error. That is the right
    trade here: mojibake is visible in the chunk preview and fixable by
    re-exporting the file, while a hard failure on a document that is 99%
    readable ASCII is not.
    """
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="replace")


def _extract_text(raw: bytes, filename: str) -> Extracted:
    body = _decode(raw)
    if _suffix(filename) == ".json":
        # Pretty-print it. One-line JSON has no structure for the chunker to
        # break on, so it would split mid-token at arbitrary characters.
        try:
            body = json.dumps(json.loads(body), indent=2, ensure_ascii=False)
        except (ValueError, TypeError):
            pass
    return Extracted(text=_normalise(body), extractor="text")


_NEEDS_CRYPTO = (
    "this PDF is encrypted with AES (common for manufacturer manuals), and reading it needs the "
    "`cryptography` package, which is not installed. Run `pip install -r requirements.txt` in "
    "backend/ and upload it again."
)


def parse_pages(spec: str | None) -> set[int] | None:
    """`"1-5, 80-120, 130"` → those page numbers, 1-based. None or empty → every page."""
    if not spec or not spec.strip():
        return None
    pages: set[int] = set()
    for part in spec.split(","):
        m = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+))?\s*", part)
        if not m:
            raise ExtractionError(f"page range {part.strip()!r} is not like '12' or '80-120'")
        low, high = int(m.group(1)), int(m.group(2) or m.group(1))
        if low < 1 or high < low:
            raise ExtractionError(f"page range {part.strip()!r} is empty or starts below page 1")
        pages.update(range(low, high + 1))
    return pages


def _extract_pdf(raw: bytes, filename: str, pages_wanted: set[int] | None = None) -> Extracted:
    ok, why = pdf_available()
    if not ok:
        raise ExtractionError(why)

    import io as _io  # noqa: PLC0415

    import pypdf  # noqa: PLC0415

    try:
        reader = pypdf.PdfReader(_io.BytesIO(raw))
    except Exception as exc:  # noqa: BLE001 — a corrupt PDF is a document problem
        raise ExtractionError(f"pypdf could not open this file: {exc}") from exc

    if getattr(reader, "is_encrypted", False):
        # Try the empty password, which is what "encrypted" means for most
        # published PDFs — permissions set, no password to open. Manufacturer
        # manuals usually lock permissions with AES, which pypdf can only undo
        # with the `cryptography` package; without it that was a bare 500.
        try:
            unlocked = reader.decrypt("")
        except pypdf.errors.DependencyError as exc:
            raise ExtractionError(_NEEDS_CRYPTO) from exc
        except Exception as exc:  # noqa: BLE001
            unlocked = None
            cause: Exception | None = exc
        else:
            cause = None
        if not unlocked:
            raise ExtractionError(
                "this PDF is password-protected. Remove the password and upload it again. "
                "Saving the password to open it later would put a credential in the corpus."
            ) from cause

    try:
        pages = list(reader.pages)
    # Without `cryptography`, unlocking an AES file reports success and the
    # failure only comes here, when the pages are decoded. That was the 500.
    except pypdf.errors.DependencyError as exc:
        raise ExtractionError(_NEEDS_CRYPTO) from exc
    except Exception as exc:  # noqa: BLE001 — a broken page tree is a document problem
        raise ExtractionError(f"pypdf could not read this file's pages: {exc}") from exc

    bodies: list[str] = []
    warnings: list[str] = []
    shifted_doc = False
    for number, page in enumerate(pages, start=1):
        if pages_wanted is not None and number not in pages_wanted:
            bodies.append("")
            continue
        try:
            raw_text = page.extract_text() or ""
        except pypdf.errors.DependencyError as exc:
            # Not one bad page: every page will fail the same way.
            raise ExtractionError(_NEEDS_CRYPTO) from exc
        except Exception as exc:  # noqa: BLE001 — one bad page is not a bad document
            raw_text = ""
            warnings.append(f"page {number} could not be read: {exc}")
        shifted_doc = shifted_doc or "\x03" in raw_text
        bodies.append(_unshift(raw_text))
    # A shifted font is a property of the document, not the page: a title page
    # with no spaces carries no 0x03 marker but is encoded the same way.
    if shifted_doc:
        bodies = [_unshift_words(body) for body in bodies]

    bodies, dropped = _strip_furniture(bodies)
    contents = [n for n, body in enumerate(bodies, start=1) if body and _is_contents(body)]
    for n in contents:
        bodies[n - 1] = ""
    if dropped:
        warnings.append(f"removed {dropped} repeated header/footer or page-number line(s)")
    if contents:
        warnings.append(f"skipped contents page(s) {', '.join(map(str, contents))}")
    # After furniture and contents stripping, so a table row is never taken for
    # a repeated footer and a contents page's dot-leader table is not restored.
    fix = (lambda t: _unshift_words(_unshift(t))) if shifted_doc else (lambda t: t)
    tables, why = _tables(raw, [n for n, body in enumerate(bodies, start=1) if body], fix)
    for n, found in tables.items():
        bodies[n - 1] += "".join(f"\n\nTable (page {n}):\n{t}" for t in found)
    if tables:
        warnings.append(f"{sum(map(len, tables.values()))} table(s) kept as rows, on {len(tables)} page(s)")
    elif why:
        warnings.append(why)
    if pages_wanted is not None:
        kept = len(pages_wanted & set(range(1, len(pages) + 1)))
        warnings.append(f"read {kept} of {len(pages)} pages (page range set on the document)")

    # Each page is normalised on its own, *before* its offset is recorded.
    # Normalising the joined text afterwards removed characters and collapsed
    # blank lines, which moved every later page break and mis-paged citations.
    parts: list[str] = []
    breaks: list[int] = []
    cursor = 0
    for body in bodies:
        body = _normalise(body)
        breaks.append(cursor)
        if body:
            parts.append(body)
            cursor += len(body) + 2  # the "\n\n" join below
        # A page with no text still gets a break, so page numbers stay aligned
        # with the document rather than with the pages that happened to parse.

    text = "\n\n".join(parts)
    page_count = len(pages)

    if len(text) < _EMPTY_THRESHOLD:
        raise ExtractionError(
            f"no readable text in {page_count} page{'s' if page_count != 1 else ''}. This is almost "
            "certainly a scanned PDF. The pages are images, so there is no text layer to "
            "extract. Daedalus has no OCR; run one over the file and upload the result."
        )
    return Extracted(
        text=text,
        page_breaks=breaks,
        page_count=page_count,
        extractor=f"pypdf {getattr(pypdf, '__version__', '?')}",
        warnings=warnings,
    )


def extract(raw: bytes, filename: str, *, pages: set[int] | None = None) -> Extracted:
    """Bytes to text. Raises `ExtractionError` with something worth reading.

    The caller records the failure against the document rather than discarding
    the upload: a file that cannot be parsed today may be parseable after a
    dependency lands, and the bytes are the only thing that cannot be recovered.
    """
    if not raw:
        raise ExtractionError("the file is empty")

    suffix = _suffix(filename)
    if suffix in PDF_TYPES:
        return _extract_pdf(raw, filename, pages)
    if suffix in TEXT_TYPES:
        extracted = _extract_text(raw, filename)
        if len(extracted.text) < _EMPTY_THRESHOLD:
            raise ExtractionError("the file holds no usable text once whitespace is removed")
        return extracted

    raise ExtractionError(
        f"{suffix or 'this file'} is not a format Daedalus can read. Supported: "
        f"{', '.join(supported_extensions())}."
    )


def _tables_available() -> bool:
    try:
        import pdfplumber  # noqa: PLC0415, F401
    except ImportError:
        return False
    return True


def status() -> dict[str, Any]:
    """What this machine can currently read — for the upload panel to state up front."""
    ok, why = pdf_available()
    return {
        "extensions": supported_extensions(),
        "pdf_available": ok,
        "pdf_detail": why or "pypdf is installed",
        "tables": _tables_available(),
        "ocr": False,
        "ocr_detail": (
            "No OCR. A scanned PDF has no text layer and is refused with that reason "
            "rather than ingested as an empty document."
        ),
    }
