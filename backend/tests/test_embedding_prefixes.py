"""Asymmetric embedders get their query and document prefixes — and the index knows which."""

from __future__ import annotations

import unittest
from unittest import mock

from app.services import embedding_models as em
from app.services import ingestion


class PrefixTest(unittest.TestCase):
    def test_lookup_follows_the_catalogue(self) -> None:
        self.assertEqual(em.prefixes("nomic-embed-text"), ("search_query: ", "search_document: "))
        self.assertEqual(em.prefixes("nomic-embed-text:latest"), ("search_query: ", "search_document: "))
        self.assertTrue(em.prefixes("qwen3-embedding:0.6b")[0].startswith("Instruct: "))
        self.assertEqual(em.prefixes("pulled-by-hand"), ("", ""))

    def test_a_question_is_embedded_with_the_query_prefix(self) -> None:
        sent = []
        with mock.patch.object(ingestion, "_embedding_target", return_value=("nomic-embed-text", "c")), \
             mock.patch.object(ingestion.ollama_client, "embed", side_effect=lambda m, t: sent.append(t) or [0.0]):
            ingestion.embed_query("why did CO2 rise?")
        self.assertEqual(sent, ["search_query: why did CO2 rise?"])

    def test_a_chunk_is_embedded_with_the_document_prefix(self) -> None:
        sent = []
        with mock.patch.object(ingestion.ollama_client, "embed", side_effect=lambda m, t: sent.append(t) or [0.0]):
            ingestion._embed_batch("nomic-embed-text", ["Recalibrate the NDIR."])  # noqa: SLF001
        self.assertEqual(sent, ["search_document: Recalibrate the NDIR."])

    def test_an_index_built_with_another_prefix_is_stale(self) -> None:
        config = {"provider": "local", "model": "nomic-embed-text", "endpoint_id": None}
        built = {"available": True, "exists": True, "documents": 12, "embedding_model": "nomic-embed-text",
                 "dimensions": 768, "error": None}
        with mock.patch.object(em, "read", return_value=config), \
             mock.patch("app.db.vector_store.describe", return_value={**built, "document_prefix": None}):
            state = em.index_state(config)
        self.assertEqual(state["index_state"], "stale")
        self.assertIn("document prefix", state["index_detail"])
        with mock.patch.object(em, "read", return_value=config), \
             mock.patch("app.db.vector_store.describe",
                        return_value={**built, "document_prefix": "search_document: "}):
            self.assertEqual(em.index_state(config)["index_state"], "current")


if __name__ == "__main__":
    unittest.main()
