"""Ingest logs by document: a run names its documents, and a document gets its runs' logs."""

from __future__ import annotations

import unittest

from app.db import corpus_store


def setUpModule() -> None:
    from app.db import migrations  # noqa: PLC0415

    migrations.migrate("corpus")


class RunDocumentsTest(unittest.TestCase):
    def test_a_run_lists_its_documents_by_name(self) -> None:
        for doc_id, name in (("rd-a", "manual.pdf"), ("rd-b", "sop.md")):
            corpus_store.add_document(
                document_id=doc_id, filename=name, stored_name=doc_id, content_hash=doc_id,
                media_type="text/plain", size_bytes=1,
            )
        corpus_store.start_run(
            run_id="rd-run", kind="ingest", strategy="recursive", chunk_size=1500,
            chunk_overlap=200, embedding_model="m", collection="c", documents_total=2,
        )
        corpus_store.log("rd-run", "chunk", "manual.pdf: 3 chunks", document_id="rd-a")
        corpus_store.log("rd-run", "embed", "manual.pdf: 3/3", document_id="rd-a")
        corpus_store.log("rd-run", "chunk", "sop.md: 1 chunk", document_id="rd-b")
        corpus_store.log("rd-run", "complete", "done")

        self.assertEqual(sorted(corpus_store.get_run("rd-run")["documents"]), ["manual.pdf", "sop.md"])

        corpus_store.delete_document("rd-b")
        listed = next(r for r in corpus_store.list_runs() if r["run_id"] == "rd-run")
        self.assertEqual(sorted(listed["documents"]), ["(deleted)", "manual.pdf"])


    def test_a_documents_log_includes_its_runs_wide_errors(self) -> None:
        corpus_store.add_document(
            document_id="dl-a", filename="guide.pdf", stored_name="dl-a", content_hash="dl-a",
            media_type="text/plain", size_bytes=1,
        )
        corpus_store.start_run(
            run_id="dl-run", kind="ingest", strategy="recursive", chunk_size=1500,
            chunk_overlap=200, embedding_model="m", collection="c", documents_total=1,
        )
        corpus_store.log("dl-run", "chunk", "guide.pdf: 2 chunks", document_id="dl-a")
        corpus_store.log("dl-run", "stamp", "could not stamp", level="error")

        events = corpus_store.document_events("dl-a")
        self.assertEqual([e["stage"] for e in events], ["chunk", "stamp"])
        row = next(d for d in corpus_store.document_logs() if d["document_id"] == "dl-a")
        self.assertEqual((row["filename"], row["runs"]), ("guide.pdf", 1))


if __name__ == "__main__":
    unittest.main()
