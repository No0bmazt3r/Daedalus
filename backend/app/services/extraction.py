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
            "image. It is listed in backend/requirements.txt — rebuild the backend "
            "container to pick it up. Text and Markdown documents work without it."
        )
    return True, ""


def _normalise(text: str) -> str:
    """Line endings, and the ligatures a PDF text layer leaves behind.

    Done here rather than in the chunker because it changes offsets, and every
    offset this module reports has to describe the string it returns.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    for bad, good in (("ﬁ", "fi"), ("ﬂ", "fl"), (" ", " "), ("’", "'")):
        text = text.replace(bad, good)
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


def _extract_pdf(raw: bytes, filename: str) -> Extracted:
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
        # published PDFs — permissions set, no password to open.
        try:
            reader.decrypt("")
        except Exception as exc:  # noqa: BLE001
            raise ExtractionError(
                "this PDF is password-protected. Remove the password and upload it again — "
                "storing the password to open it later would put a credential in the corpus."
            ) from exc

    parts: list[str] = []
    breaks: list[int] = []
    warnings: list[str] = []
    cursor = 0
    for number, page in enumerate(reader.pages, start=1):
        try:
            body = page.extract_text() or ""
        except Exception as exc:  # noqa: BLE001 — one bad page is not a bad document
            body = ""
            warnings.append(f"page {number} could not be read: {exc}")
        body = body.strip()
        breaks.append(cursor)
        if body:
            parts.append(body)
            cursor += len(body) + 2  # the "\n\n" join below
        # A page with no text still gets a break, so page numbers stay aligned
        # with the document rather than with the pages that happened to parse.

    text = _normalise("\n\n".join(parts))
    pages = len(reader.pages)

    if len(text) < _EMPTY_THRESHOLD:
        raise ExtractionError(
            f"no readable text in {pages} page{'s' if pages != 1 else ''}. This is almost "
            "certainly a scanned PDF — the pages are images, so there is no text layer to "
            "extract. Daedalus has no OCR; run one over the file and upload the result."
        )
    return Extracted(
        text=text,
        page_breaks=breaks,
        page_count=pages,
        extractor=f"pypdf {getattr(pypdf, '__version__', '?')}",
        warnings=warnings,
    )


def extract(raw: bytes, filename: str) -> Extracted:
    """Bytes to text. Raises `ExtractionError` with something worth reading.

    The caller records the failure against the document rather than discarding
    the upload: a file that cannot be parsed today may be parseable after a
    dependency lands, and the bytes are the only thing that cannot be recovered.
    """
    if not raw:
        raise ExtractionError("the file is empty")

    suffix = _suffix(filename)
    if suffix in PDF_TYPES:
        return _extract_pdf(raw, filename)
    if suffix in TEXT_TYPES:
        extracted = _extract_text(raw, filename)
        if len(extracted.text) < _EMPTY_THRESHOLD:
            raise ExtractionError("the file holds no usable text once whitespace is removed")
        return extracted

    raise ExtractionError(
        f"{suffix or 'this file'} is not a format Daedalus can read. Supported: "
        f"{', '.join(supported_extensions())}."
    )


def status() -> dict[str, Any]:
    """What this machine can currently read — for the upload panel to state up front."""
    ok, why = pdf_available()
    return {
        "extensions": supported_extensions(),
        "pdf_available": ok,
        "pdf_detail": why or "pypdf is installed",
        "ocr": False,
        "ocr_detail": (
            "No OCR. A scanned PDF has no text layer and is refused with that reason "
            "rather than ingested as an empty document."
        ),
    }
