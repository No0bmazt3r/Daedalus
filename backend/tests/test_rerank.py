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


class RerankerFitTest(unittest.TestCase):
    """What this machine can afford — judged without downloading anything."""

    def test_every_entry_is_complete_and_pinned(self) -> None:
        for model_id, entry in reranker.CATALOGUE.items():
            with self.subTest(model=model_id):
                self.assertEqual(entry["id"], model_id)
                self.assertRegex(entry["revision"], r"^[0-9a-f]{40}$")
                self.assertTrue(entry["onnx"].endswith(".onnx"))
                for key in ("multilingual", "size_bytes", "compute_m", "quantized", "quality", "licence"):
                    self.assertIn(key, entry)

    def test_bigger_models_are_estimated_slower(self) -> None:
        tiny, l6 = reranker.estimate_ms("ms-marco-tinybert-l2"), reranker.estimate_ms("ms-marco-minilm-l6")
        self.assertLess(tiny, l6)
        self.assertLess(l6, reranker.estimate_ms("bge-reranker-v2-m3"))
        self.assertGreater(reranker.estimate_ms("ms-marco-minilm-l6", threads=1),
                           reranker.estimate_ms("ms-marco-minilm-l6", threads=4))

    def test_verdicts(self) -> None:
        gb = 1_000_000_000
        self.assertEqual(reranker._verdict(gb // 10, 4 * gb, 500)[0], "safe")  # noqa: SLF001
        self.assertEqual(reranker._verdict(3 * gb, 4 * gb, 500)[0], "marginal")  # noqa: SLF001
        self.assertEqual(reranker._verdict(5 * gb, 4 * gb, 500)[0], "will_not_fit")  # noqa: SLF001
        self.assertEqual(reranker._verdict(gb // 10, 4 * gb, 1500)[0], "marginal")  # noqa: SLF001
        self.assertEqual(reranker._verdict(gb // 10, 4 * gb, 5000)[0], "will_not_fit")  # noqa: SLF001
        self.assertEqual(reranker._verdict(gb // 10, None, 500)[0], "safe")  # unknown RAM is not a failure  # noqa: SLF001

    def test_recommends_the_strongest_safe_model_and_a_multilingual_one(self) -> None:
        roomy = {"available_bytes": 64_000_000_000, "total_bytes": 64_000_000_000, "cpu": "test"}
        with mock.patch.object(reranker.fit_verdict, "machine", return_value=roomy), \
             mock.patch.object(reranker, "estimate_ms", return_value=100):
            rec = reranker.fit()["recommended"]
        self.assertEqual(rec["english"], "bge-reranker-v2-m3")  # everything fits; highest quality wins
        self.assertTrue(reranker.CATALOGUE[rec["malay"]]["multilingual"])

    def test_falls_back_to_the_least_over_budget(self) -> None:
        def slow(model_id: str, threads: int | None = None) -> int:
            return 1500 if model_id == "mmarco-mminilm-l12" else 9000
        with mock.patch.object(reranker, "estimate_ms", side_effect=slow):
            rec = reranker.fit()["recommended"]
        self.assertEqual(rec["malay"], "mmarco-mminilm-l12")
        self.assertEqual(rec["english"], "mmarco-mminilm-l12")  # nothing safe: least over budget

    def test_models_carry_fit_and_recommendation(self) -> None:
        rows = reranker.models()
        self.assertEqual({r["id"] for r in rows}, set(reranker.CATALOGUE))
        for r in rows:
            self.assertIn(r["fit"]["verdict"], ("safe", "marginal", "will_not_fit"))
            self.assertIn(r["fit"]["latency_source"], ("estimated", "measured"))
        self.assertTrue(any(r["recommended_for"] for r in rows))


class EmbeddingFreezeTest(unittest.TestCase):
    """Choosing the embedding model is a Track 1 setting, frozen with the comparison."""

    def tearDown(self) -> None:
        fixtures.set_track("vector")

    def test_selection_is_refused_while_frozen(self) -> None:
        (rag_config.CONFIG_PATH).write_text(json.dumps({"track": "vector", "frozen": True}))
        with self.assertRaises(rag_config.ConfigFrozen):
            embedding_models.write(provider="local", model="nomic-embed-text")

    def test_selection_works_when_not_frozen(self) -> None:
        fixtures.set_track("vector")
        written = embedding_models.write(provider="local", model="nomic-embed-text")
        self.assertEqual(written["model"], "nomic-embed-text")
