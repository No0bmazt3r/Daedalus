"""Track 1's two-stage retrieval: a wide Chroma pool, re-scored by a cross-encoder."""

from __future__ import annotations

import json
import unittest
from unittest import mock

from app.db import audit_store, vector_store
from app.services import embedding_models, ingestion, rag_config, reranker
from app.services.agent_tools import registry

from . import fixtures

TEXTS = [f"passage {i}" for i in range(20)]


class _Collection:
    def __init__(self) -> None:
        self.asked: list[int] = []

    def query(self, *, query_embeddings, n_results, where):  # noqa: ANN001, ANN201
        self.asked.append(n_results)
        n = min(n_results, len(TEXTS))
        return {
            "documents": [TEXTS[:n]],
            "metadatas": [[{"source_file": f"sop{i}.pdf"} for i in range(n)]],
            "distances": [[round(0.1 + i / 100, 3) for i in range(n)]],
            "ids": [[f"c{i}" for i in range(n)]],
        }


class RerankTest(unittest.TestCase):
    def setUp(self) -> None:
        fixtures.set_track("vector")
        self.collection = _Collection()
        self.patches = [
            mock.patch.object(embedding_models, "index_state",
                              return_value={"index_state": "current", "collection": "test_idx", "index_detail": ""}),
            mock.patch.object(vector_store, "get_collection", return_value=self.collection),
            mock.patch.object(ingestion, "embed_query", return_value=[0.0, 1.0]),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()

    def search(self, qid: str | None = None) -> dict:
        return registry.call("search_corpus", {"query": "high CO2", "top_k": 5}, query_id=qid)

    def test_wide_pool_is_rescored_and_cut_to_top_k(self) -> None:
        # The cross-encoder prefers what Chroma ranked last.
        with mock.patch.object(reranker, "score", side_effect=lambda q, ps, model_id: [i / 20 for i in range(len(ps))]):
            env = self.search("q_rerank_test")
        self.assertEqual(self.collection.asked, [rag_config.DEFAULT_CANDIDATES])
        chunks = env["data"]["chunks"]
        self.assertEqual([c["chunk_id"] for c in chunks], ["c19", "c18", "c17", "c16", "c15"])
        self.assertEqual(chunks[0]["vector_rank"], 20)
        self.assertIn("re-ranked from 20", env["detail"])

        row = audit_store.trace("q_rerank_test")["rag_logs"][0]
        self.assertEqual(row["rerank_model"], "ms-marco-minilm-l6")
        self.assertEqual(row["candidate_count"], 20)
        self.assertEqual(json.loads(row["retrieved_chunk_ids"]), ["c19", "c18", "c17", "c16", "c15"])
        self.assertEqual(json.loads(row["rerank_scores"]), [0.95, 0.9, 0.85, 0.8, 0.75])

    def test_unavailable_reranker_keeps_vector_order_and_says_so(self) -> None:
        with mock.patch.object(reranker, "score", side_effect=reranker.RerankUnavailable("not downloaded")):
            env = self.search("q_rerank_fallback")
        self.assertEqual([c["chunk_id"] for c in env["data"]["chunks"]], ["c0", "c1", "c2", "c3", "c4"])
        self.assertIn("vector order: not downloaded", env["detail"])
        row = audit_store.trace("q_rerank_fallback")["rag_logs"][0]
        self.assertIsNone(row["rerank_model"])

    def test_off_means_top_k_straight_from_chroma(self) -> None:
        rag_config.write(rerank={"enabled": False})
        try:
            with mock.patch.object(reranker, "score", side_effect=AssertionError("scored")):
                env = self.search()
            self.assertEqual(self.collection.asked, [5])
            self.assertIn("re-ranking is off", env["detail"])
        finally:
            rag_config.write(rerank={"enabled": True})

    def test_rerank_settings_are_validated_and_frozen_with_the_track(self) -> None:
        with self.assertRaises(ValueError):
            rag_config.write(rerank={"candidates": 500})
        with self.assertRaises(ValueError):
            rag_config.write(rerank={"model": "nope"})
        written = rag_config.write(rerank={"model": "mmarco-mminilm-l12", "candidates": 30})
        self.assertEqual(written["rerank"], {"enabled": True, "model": "mmarco-mminilm-l12", "candidates": 30})
        self.assertEqual(written["track"], "vector")  # untouched by a rerank-only write
        raw = json.loads(rag_config.CONFIG_PATH.read_text())
        rag_config.CONFIG_PATH.write_text(json.dumps({**raw, "frozen": True}))
        try:
            with self.assertRaises(rag_config.ConfigFrozen):
                rag_config.write(rerank={"enabled": False})
        finally:
            fixtures.set_track("vector")

    def test_not_downloaded_is_a_stated_unavailability(self) -> None:
        with self.assertRaises(reranker.RerankUnavailable) as caught:
            reranker.score("q", ["p"], model_id="ms-marco-minilm-l6")
        self.assertIn("not downloaded", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
