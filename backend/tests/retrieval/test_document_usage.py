"""Which documents earn their place: retrieved per track, and cited by answers."""

from __future__ import annotations

import json
import unittest

from app.db import audit_store, chat_store, corpus_store
from app.services import document_usage, ingestion


def setUpModule() -> None:
    from app.db import migrations  # noqa: PLC0415

    migrations.migrate("corpus")


class DocumentUsageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.ids = [
            ingestion.store_upload(b"used", "Usage_Cited.md")["document_id"],
            ingestion.store_upload(b"noise", "Usage_Noise.md")["document_id"],
            ingestion.store_upload(b"idle", "Usage_Idle.md")["document_id"],
        ]

    def tearDown(self) -> None:
        for document_id in self.ids:
            corpus_store.delete_document(document_id)

    def test_retrieved_and_cited_are_counted_separately(self) -> None:
        audit_store.log("rag_logs", query_id="usage-q", track="vector",
                        source_files=json.dumps(["Usage_Cited.md", "Usage_Noise.md"]))
        audit_store.log("rag_logs", query_id="usage-seed", track="vector", vector_db_used="seed",
                        source_files=json.dumps(["Usage_Idle.md"]))
        session = chat_store.create_session()
        chat_store.append_message(session["session_id"], "assistant", "Do this first [D1].", evidence={
            "citations": [
                {"label": "D1", "kind": "document", "source_file": "Usage_Cited.md"},
                {"label": "D2", "kind": "document", "source_file": "Usage_Noise.md"},
            ],
        })
        rows = {r["filename"]: r for r in document_usage.usage()}
        self.assertEqual((rows["Usage_Cited.md"]["verdict"], rows["Usage_Cited.md"]["cited"]), ("cited", 1))
        self.assertEqual(rows["Usage_Noise.md"]["verdict"], "never_cited")
        self.assertEqual(rows["Usage_Idle.md"]["verdict"], "never_retrieved")  # a seeded walk does not count


if __name__ == "__main__":
    unittest.main()
