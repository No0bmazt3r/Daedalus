"""Track 1's hybrid retrieval: BM25 (FTS5) keyword hits fused with the vector ranking by RRF."""

from __future__ import annotations

import unittest
from unittest import mock

from app.db import corpus_store, migrations, vector_store
from app.services import embedding_models, ingestion, rag_config, reranker
from app.services.agent_tools import registry, search

from .. import fixtures

COLLECTION = "hybrid_idx"


class _Collection:
    """A vector side that never finds the valve chunk — the case hybrid exists for."""

    def query(self, *, query_embeddings, n_results, where):  # noqa: ANN001, ANN201
        return {
            "documents": [["general reactor overview", "safety briefing"]],
            "metadatas": [[{"source_file": "a.pdf"}, {"source_file": "b.pdf"}]],
            "distances": [[0.2, 0.3]],
            "ids": [["h-dense-0", "h-dense-1"]],
        }


class HybridTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        migrations.migrate_all()
        corpus_store.add_document(
            document_id="h-doc", filename="valves.pdf", stored_name="h-doc", content_hash="h-doc",
            media_type="text/plain", size_bytes=1, source_type="sop", title="Valve SOP",
        )
        texts = ["general reactor overview", "Close ABV-1 before venting the column.", "unrelated text"]
        corpus_store.replace_chunks("h-doc", [
            {"chunk_id": cid, "ordinal": i, "text": t, "char_start": 0, "char_end": len(t)}
            for i, (cid, t) in enumerate(zip(["h-dense-0", "h-valve", "h-other"], texts))
        ], run_id="test")
        corpus_store.mark_embedded(["h-dense-0", "h-valve", "h-other"], model="m", collection=COLLECTION)

    def setUp(self) -> None:
        fixtures.set_track("vector")
        self.patches = [
            mock.patch.object(embedding_models, "index_state",
                              return_value={"index_state": "current", "collection": COLLECTION, "index_detail": ""}),
            mock.patch.object(vector_store, "get_collection", return_value=_Collection()),
            mock.patch.object(ingestion, "embed_query", return_value=[0.0, 1.0]),
            mock.patch.object(reranker, "score", side_effect=reranker.RerankUnavailable("off for test")),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        rag_config.write(retrieval={"hybrid": True})

    def search(self, query: str) -> dict:
        return registry.call("search_corpus", {"query": query, "top_k": 5})

    def test_keyword_hit_the_vector_side_missed_is_fused_in(self) -> None:
        env = self.search("how do I close ABV-1")
        ids = [c["chunk_id"] for c in env["data"]["chunks"]]
        self.assertIn("h-valve", ids)
        valve = next(c for c in env["data"]["chunks"] if c["chunk_id"] == "h-valve")
        self.assertIsNone(valve["dense_rank"])
        self.assertEqual(valve["keyword_rank"], 1)
        self.assertEqual(valve["source_file"], "valves.pdf")
        self.assertIn("keyword hits", env["detail"])

    def test_logged_per_query(self) -> None:
        from app.db import audit_store  # noqa: PLC0415

        registry.call("search_corpus", {"query": "close ABV-1", "top_k": 5}, query_id="q_hybrid_log")
        self.assertGreaterEqual(audit_store.trace("q_hybrid_log")["rag_logs"][0]["keyword_hits"], 1)

    def test_found_by_both_outranks_found_by_one(self) -> None:
        env = self.search("reactor overview")
        self.assertEqual(env["data"]["chunks"][0]["chunk_id"], "h-dense-0")
        self.assertEqual(env["data"]["chunks"][0]["keyword_rank"], 1)

    def test_off_is_vector_only(self) -> None:
        rag_config.write(retrieval={"hybrid": False})
        env = self.search("how do I close ABV-1")
        self.assertEqual([c["chunk_id"] for c in env["data"]["chunks"]], ["h-dense-0", "h-dense-1"])

    def test_query_text_cannot_become_fts_syntax(self) -> None:
        for q in ['"', 'ABV-1 AND (', "NEAR(x y) *", "", "col:text"]:
            corpus_store.keyword_search(q, collection=COLLECTION, limit=5)  # must not raise

    def test_title_and_other_collections(self) -> None:
        self.assertEqual(
            {r["chunk_id"] for r in corpus_store.keyword_search("valve", collection=COLLECTION, limit=5)},
            {"h-dense-0", "h-valve", "h-other"},  # all match on the document title
        )
        self.assertEqual(corpus_store.keyword_search("ABV-1", collection="elsewhere", limit=5), [])
        self.assertEqual(corpus_store.keyword_search("ABV-1", collection=COLLECTION, limit=5,
                                                     source_type="manual"), [])

    def test_rechunking_and_deleting_keep_the_index_in_step(self) -> None:
        corpus_store.add_document(
            document_id="h-doc2", filename="tmp.txt", stored_name="h-doc2", content_hash="h-doc2",
            media_type="text/plain", size_bytes=1,
        )
        corpus_store.replace_chunks("h-doc2", [{"chunk_id": "h-z", "ordinal": 0, "text": "zirconium",
                                                "char_start": 0, "char_end": 9}], run_id="test")
        corpus_store.mark_embedded(["h-z"], model="m", collection=COLLECTION)
        self.assertEqual(len(corpus_store.keyword_search("zirconium", collection=COLLECTION, limit=5)), 1)
        corpus_store.delete_document("h-doc2")
        self.assertEqual(corpus_store.keyword_search("zirconium", collection=COLLECTION, limit=5), [])

    def test_rrf(self) -> None:
        fused = search.fuse([{"chunk_id": "a"}, {"chunk_id": "b"}], [{"chunk_id": "b"}, {"chunk_id": "c"}])
        self.assertEqual([c["chunk_id"] for c in fused], ["b", "a", "c"])


if __name__ == "__main__":
    unittest.main()
