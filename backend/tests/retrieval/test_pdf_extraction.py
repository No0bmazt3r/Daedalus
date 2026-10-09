"""PDF uploads: an encrypted manual opens, and no parser failure becomes an HTTP 500."""

from __future__ import annotations

import io
import unittest
from unittest import mock

import pypdf

from app.services import extraction, ingestion

TEXT = "The NDIR analyser measures CO2 by infrared absorption. " * 4


def _plain_pdf() -> bytes:
    """A one-page PDF with a real text layer, written by hand (no PDF library needed)."""
    stream = f"BT /F1 10 Tf 40 800 Td ({TEXT}) Tj ET".encode()
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


class UploadNeverCrashesTest(unittest.TestCase):
    def test_an_unexpected_parser_error_is_recorded_on_the_document(self) -> None:
        with mock.patch.object(extraction, "extract", side_effect=KeyError("/Kids")):
            doc = ingestion.store_upload(b"%PDF-1.4 not really", "broken.pdf")
        self.assertEqual(doc["extract_status"], "failed")
        self.assertIn("KeyError", doc["extract_error"])


if __name__ == "__main__":
    unittest.main()
