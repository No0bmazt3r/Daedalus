"""PDF uploads: an encrypted manual opens, and no parser failure becomes an HTTP 500."""

from __future__ import annotations

import io
import unittest
from unittest import mock

import pypdf

from app.blueprints import extraction, ingestion

TEXT = "The NDIR analyser measures CO2 by infrared absorption. " * 4


def _plain_pdf(stream: bytes | None = None) -> bytes:
    """A one-page PDF with a real text layer, written by hand (no PDF library needed)."""
    stream = stream or f"BT /F1 10 Tf 40 800 Td ({TEXT}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for n, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % n + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for off in offsets:
        out.write(b"%010d 00000 n \n" % off)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref))
    return out.getvalue()


def _pdf(*, owner_password: str | None = None) -> bytes:
    """Optionally locked like a manufacturer manual: AES, empty user password, editing locked."""
    raw = _plain_pdf()
    if owner_password is None:
        return raw
    writer = pypdf.PdfWriter(clone_from=pypdf.PdfReader(io.BytesIO(raw)))
    writer.encrypt(user_password="", owner_password=owner_password, algorithm="AES-256")
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def setUpModule() -> None:
    from app.db import migrations  # noqa: PLC0415

    migrations.migrate("corpus")


class PdfExtractionTest(unittest.TestCase):
    def test_an_aes_locked_manual_is_read(self) -> None:
        got = extraction.extract(_pdf(owner_password="maker"), "manual.pdf")
        self.assertIn("NDIR analyser", got.text)

    def test_missing_cryptography_is_explained_not_a_crash(self) -> None:
        # The real failure: unlocking reports success, decoding a page then fails.
        missing = pypdf.errors.DependencyError("cryptography>=3.1 is required for AES algorithm")
        with mock.patch.object(pypdf.PageObject, "extract_text", side_effect=missing):
            with self.assertRaises(extraction.ExtractionError) as caught:
                extraction.extract(_pdf(owner_password="maker"), "manual.pdf")
        self.assertIn("cryptography", str(caught.exception))


class ShiftedFontTest(unittest.TestCase):
    """Fonts whose codes sit 29 below the letters, with 0x03 as the space."""

    def test_shifted_runs_are_decoded_and_plain_text_is_left_alone(self) -> None:
        encoded = "\x37\x4b\x48\x03\x2b\x4c\x4a\x4b\x12\x2f\x52\x5a\x03\x44\x4f\x44\x55\x50"  # The High/Low alarm
        page = f"Thank you for purchasing.\n{encoded}\n6.3 Alarm setting"
        self.assertEqual(extraction._unshift(page), "Thank you for purchasing.\nThe High/Low alarm\n6.3 Alarm setting")  # noqa: SLF001

    def test_a_page_without_the_marker_is_untouched(self) -> None:
        self.assertEqual(extraction._unshift("WKH plain text"), "WKH plain text")  # noqa: SLF001


class UploadNeverCrashesTest(unittest.TestCase):
    def test_an_unexpected_parser_error_is_recorded_on_the_document(self) -> None:
        with mock.patch.object(extraction, "extract", side_effect=KeyError("/Kids")):
            doc = ingestion.store_upload(b"%PDF-1.4 not really", "broken.pdf")
        self.assertEqual(doc["extract_status"], "failed")
        self.assertIn("KeyError", doc["extract_error"])



def _table_pdf() -> bytes:
    """Prose, then a ruled 2-column limits table: grid lines plus one text run per cell."""
    rows = [("Parameter", "Limit"), ("CO2 high alarm", "5000 ppm"), ("Bed temperature", "120 C")]
    ops = [f"BT /F1 10 Tf 40 800 Td ({TEXT}) Tj ET"]
    top, h, xs = 700, 20, (40, 200, 360)
    for i in range(len(rows) + 1):
        ops.append(f"{xs[0]} {top - i * h} m {xs[-1]} {top - i * h} l S")
    for x in xs:
        ops.append(f"{x} {top} m {x} {top - len(rows) * h} l S")
    for i, row in enumerate(rows):
        for x, cell in zip(xs, row):
            ops.append(f"BT /F1 10 Tf {x + 4} {top - (i + 1) * h + 6} Td ({cell}) Tj ET")
    return _plain_pdf("\n".join(ops).encode())


class PdfTableTest(unittest.TestCase):
    def test_a_ruled_table_keeps_each_row_whole(self) -> None:
        extracted = extraction.extract(_table_pdf(), "limits.pdf")
        self.assertIn("| CO2 high alarm | 5000 ppm |", extracted.text)
        self.assertIn("| Parameter | Limit |", extracted.text)
        self.assertIn("NDIR analyser", extracted.text)  # pypdf's text is kept, not replaced
        self.assertTrue(any("table(s) kept as rows" in w for w in extracted.warnings))

    def test_without_pdfplumber_the_text_still_ingests(self) -> None:
        with mock.patch.dict("sys.modules", {"pdfplumber": None}):
            extracted = extraction.extract(_table_pdf(), "limits.pdf")
        self.assertNotIn("| CO2 high alarm |", extracted.text)
        self.assertIn("pdfplumber is not installed", " ".join(extracted.warnings))

    def test_cid_glyphs_decode_like_pypdf_shifted_text(self) -> None:
        # "Hi there" shifted 29 down, as pdfminer reports the Fuji manual's glyphs.
        cids = "".join(f"(cid:{ord(c) - 29})" for c in "Hi there")
        fix = lambda t: extraction._unshift_words(extraction._unshift(t))  # noqa: E731
        self.assertEqual(fix(extraction._cell(cids)), "Hi there")


if __name__ == "__main__":
    unittest.main()
