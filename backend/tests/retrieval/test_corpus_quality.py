"""Corpus quality: page furniture, contents pages, shifted fonts, ligatures, page ranges, chunk tails."""

from __future__ import annotations

import unittest

from app.services import chunking, extraction, ingestion


class ExtractionCleanupTest(unittest.TestCase):
    def test_repeated_headers_and_page_numbers_go_body_stays(self) -> None:
        topics = ["rinse", "zero", "span", "vent", "drain", "record"]
        bodies = ["\n".join(f"{t} the probe, part {i}." for i in range(1, 9)) for t in topics]
        pages = [f"SOP No. EQ-01-09 Date Revised 03-31-20\nPage {n} of 6\n{bodies[n - 1]}\n{n}" for n in range(1, 7)]
        cleaned, dropped = extraction._strip_furniture(pages)
        self.assertEqual(cleaned[2], bodies[2])
        self.assertEqual(dropped, 18)

    def test_contents_page_is_recognised(self) -> None:
        toc = "Contents\n1. Overview ........ 3\n2. Installation ...... 9\n3. Operation ...... 14\n4. Maintenance ..... 30\n5. Specs ..... 40"
        self.assertTrue(extraction._is_contents(toc))
        self.assertFalse(extraction._is_contents("1. Close the valve.\n2. Vent the line.\n3. Zero.\n4. Span.\n5. Record."))

    def test_shifted_words_decode_real_capitals_do_not(self) -> None:
        self.assertEqual(extraction._unshift_words("FDOLEUDWLRQ CAUTION PRESSURE"), "calibration CAUTION PRESSURE")

    def test_ligature_glyphs(self) -> None:
        self.assertEqual(extraction._normalise("¿re and Àow, ¿Qué?"), "fire and flow, ¿Qué?")

    def test_page_ranges(self) -> None:
        self.assertEqual(extraction.parse_pages("1-3, 7"), {1, 2, 3, 7})
        self.assertIsNone(extraction.parse_pages(" "))
        with self.assertRaises(extraction.ExtractionError):
            extraction.parse_pages("9-3")


class ChunkTailTest(unittest.TestCase):
    def test_a_short_tail_joins_its_neighbour_instead_of_duplicating_it(self) -> None:
        text = ("Calibrate the analyser weekly. " * 40).strip() + "\n\nRecord it."
        chunks = chunking.chunk_text(text, size=1200, overlap=200)
        self.assertTrue(all(len(c.text) > 300 for c in chunks), [len(c.text) for c in chunks])
        self.assertTrue(chunks[-1].text.endswith("Record it."))
        self.assertEqual(text[chunks[-1].char_start:chunks[-1].char_end], chunks[-1].text)

    def test_context_header_names_document_and_section(self) -> None:
        row = {"text": "Step 3: close the valve.", "section_title": "Shutdown"}
        self.assertEqual(ingestion.context_text({"title": "SOP Relief"}, row),
                         "SOP Relief — Shutdown\nStep 3: close the valve.")


if __name__ == "__main__":
    unittest.main()
