"""Track 1's retrieval options: hybrid BM25 + vector (RRF), tag variants, the re-rank
score floor, the focused passage window and edge ordering."""

from __future__ import annotations

import unittest
from unittest import mock

from app.db import corpus_store, migrations, vector_store
from app.forge import embedding_models, reranker
from app.blueprints import ingestion, rag_config
from app.chat.orchestration import evidence
from app.tools.agent_tools import registry, search

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
        rag_config.write(retrieval={"hybrid": True, "min_rerank_score": None, "window": "head", "order": "rank"})

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


    def test_a_tag_written_without_its_hyphen_still_matches(self) -> None:
        for q in ("ABV1", "abv 1", "ABV-1"):
            ids = {r["chunk_id"] for r in corpus_store.keyword_search(q, collection=COLLECTION, limit=5)}
            self.assertIn("h-valve", ids, q)
        # A numeric range is not a tag: "4-20" must not also search "420".
        self.assertEqual(corpus_store._forms("4-20"), {"4-20"})

    def _scored(self, scores: list[float]):  # noqa: ANN202
        return mock.patch.object(reranker, "score", side_effect=lambda q, ps, model_id: scores[:len(ps)])

    def test_below_the_floor_nothing_reaches_the_model(self) -> None:
        rag_config.write(retrieval={"min_rerank_score": 0.2})
        with self._scored([0.01, 0.02, 0.03]):
            env = self.search("how do I close ABV-1")
        self.assertEqual(env["data"]["chunks"], [])
        self.assertEqual(env["data"]["below_min_score"], 3)
        self.assertIn("treated as not covering this", env["detail"])

    def test_the_floor_keeps_what_clears_it(self) -> None:
        rag_config.write(retrieval={"min_rerank_score": 0.2})
        with self._scored([0.9, 0.01, 0.5]):
            env = self.search("how do I close ABV-1")
        self.assertEqual([round(c["rerank_score"], 2) for c in env["data"]["chunks"]], [0.9, 0.5])

    def test_the_floor_is_skipped_without_rerank_scores(self) -> None:
        rag_config.write(retrieval={"min_rerank_score": 0.2})
        env = self.search("how do I close ABV-1")  # setUp makes the re-ranker unavailable
        self.assertTrue(env["data"]["chunks"])
        self.assertIn("floor not applied", env["detail"])

    def test_focused_window_reaches_past_the_head_and_into_the_next_chunk(self) -> None:
        filler = "General notes on the column. " * 30  # ~870 chars, past the 700 shown
        core = {"text": filler + "Purge with nitrogen", "char_start": 0, "char_end": len(filler) + 19}
        nxt = {"text": "nitrogen for ten minutes before opening.", "char_start": len(filler) + 11,
               "char_end": len(filler) + 51}
        out = search.focus("how long to purge with nitrogen", {0: core, 1: nxt})
        self.assertIn("Purge with nitrogen for ten minutes", out)
        self.assertLessEqual(len(out), evidence.PASSAGE_CHARS)
        # No query term anywhere: the chunk's head, as before.
        self.assertTrue(search.focus("zzz qqq", {0: core, 1: nxt}).startswith("General notes"))

    def test_focused_passage_is_what_the_pack_shows(self) -> None:
        rag_config.write(retrieval={"window": "focused"})
        env = self.search("how do I close ABV-1")
        valve = next(c for c in env["data"]["chunks"] if c["chunk_id"] == "h-valve")
        self.assertEqual(valve["passage"], "Close ABV-1 before venting the column.")

    def test_edges_order_reorders_the_prompt_not_the_log(self) -> None:
        chunks = [{"chunk_id": f"c{i}", "text": f"passage {i}", "source_file": "a.pdf"} for i in range(1, 6)]
        env = {"tool": "search_corpus", "ok": True, "status": "ok", "integrity": "corpus", "citable": True,
               "data": {"chunks": chunks}}
        rag_config.write(retrieval={"order": "edges"})
        pack = evidence.build([env])
        shown = [i.citation["chunk_id"] for i in pack.items if i.kind == "document"]
        self.assertEqual(shown, ["c1", "c3", "c5", "c4", "c2"])
        self.assertEqual([c["chunk_id"] for c in chunks], ["c1", "c2", "c3", "c4", "c5"])

    def test_options_are_validated(self) -> None:
        for bad in ({"min_rerank_score": 2}, {"window": "all"}, {"order": "random"}, {"hybrid": "yes"}):
            with self.assertRaises(ValueError):
                rag_config.write(retrieval=bad)


if __name__ == "__main__":
    unittest.main()
