"""Blueprints' Track 1 replay: a recorded vector query read back, never re-run."""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.db import audit_store, migrations
from app.main import app


class ReplayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        migrations.migrate("corpus")
        cls.client = TestClient(app)

    def test_a_recorded_query_reads_back_with_its_missing_chunks_reported(self) -> None:
        qid = audit_store.new_query_id()
        audit_store.log("rag_logs", query_id=qid, track="vector", query_text="ndir drift", top_k=2,
                        vector_db_used="daedalus_x", retrieved_chunk_ids=["gone_a", "gone_b"],
                        retrieval_scores=[0.1, 0.3], source_files=["sop.pdf"], retrieval_latency_ms=12)
        body = self.client.get(f"/api/corpus/retrieval/{qid}").json()
        self.assertTrue(body["available"])
        self.assertEqual([c["distance"] for c in body["chunks"]], [0.1, 0.3])
        self.assertEqual(body["missing_count"], 2)
        self.assertEqual((body["collection"], body["source_files"]), ("daedalus_x", ["sop.pdf"]))
        listed = self.client.get("/api/corpus/retrievals").json()["retrievals"]
        self.assertTrue(any(r["query_id"] == qid and r["replayable"] for r in listed))

    def test_an_unknown_query_is_unavailable_not_an_error(self) -> None:
        body = self.client.get("/api/corpus/retrieval/q_nope").json()
        self.assertFalse(body["available"])


if __name__ == "__main__":
    unittest.main()
