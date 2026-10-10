"""The tool registry's gates, as they apply to the orchestrator's tools."""

from __future__ import annotations

import json
import unittest

from app.db import audit_store
from app.services import agent_tools, rag_config
from app.services.agent_tools import registry

from .. import fixtures


class RegistryTest(unittest.TestCase):
    def test_registry_tracks_match_rag_config(self) -> None:
        self.assertEqual(tuple(registry.TRACKS), tuple(rag_config.TRACKS))

    def test_other_tracks_retrieval_is_refused(self) -> None:
        fixtures.set_track("vector")
        env = agent_tools.call("graph_walk", {"query": "high co2"})
        self.assertEqual(env["status"], "refused")
        fixtures.set_track("graph")
        try:
            self.assertEqual(agent_tools.call("search_corpus", {"query": "x"})["status"], "refused")
        finally:
            fixtures.set_track("vector")

    def test_graph_walk_is_one_replayable_rag_row(self) -> None:
        fixtures.set_track("graph")
        try:
            query_id = audit_store.new_query_id()
            env = agent_tools.call("graph_walk", {"query": "what should I do about high co2"},
                                   query_id=query_id)
        finally:
            fixtures.set_track("vector")
        self.assertTrue(env["ok"], env["detail"])
        rows = audit_store.trace(query_id)["rag_logs"]
        self.assertEqual(len(rows), 1)
        path = json.loads(rows[0]["traversal_path"])
        self.assertGreaterEqual(path["hop_count"], 1)
        self.assertEqual(rows[0]["hop_count"], path["hop_count"])
        self.assertTrue(json.loads(rows[0]["retrieved_chunk_ids"]))

    def test_simple_view_lists_exactly_what_the_planner_uses(self) -> None:
        for track, retrieval in (("vector", "search_corpus"), ("graph", "graph_walk")):
            fixtures.set_track(track)
            answering = agent_tools.catalogue()["answering"]
            self.assertEqual(answering["track"], track)
            self.assertEqual(answering["tools"],
                             ["get_live_reading", "get_trend", retrieval])
        fixtures.set_track("vector")

    def test_sensor_category_is_listed(self) -> None:
        self.assertIn("sensor", [c for c, _ in registry.CATEGORIES])


if __name__ == "__main__":
    unittest.main()
