"""Simple mode is enforced at dispatch, not only drawn in Settings."""

from __future__ import annotations

import unittest

from app.db import tool_policy_store
from app.services import agent_tools

from .. import fixtures

ANSWERING_VECTOR = {"get_live_reading", "get_trend", "search_corpus"}


class ToolModeTest(unittest.TestCase):
    def setUp(self) -> None:
        fixtures.build()
        fixtures.set_track("vector")

    def tearDown(self) -> None:
        tool_policy_store.set_mode("simple")
        tool_policy_store.enable_all()
        fixtures.set_track("vector")

    def available(self) -> set[str]:
        return {t["name"] for t in agent_tools.catalogue()["tools"] if t["available"]}

    def test_simple_is_the_default(self) -> None:
        self.assertEqual(agent_tools.catalogue()["mode"]["mode"], "simple")

    def test_simple_offers_only_the_answering_tools(self) -> None:
        tool_policy_store.set_mode("simple")
        self.assertEqual(self.available(), ANSWERING_VECTOR)
        self.assertEqual({s["function"]["name"] for s in agent_tools.schemas()}, ANSWERING_VECTOR)

    def test_simple_refuses_everything_else_at_dispatch(self) -> None:
        tool_policy_store.set_mode("simple")
        for name in ("get_current_time", "knowledge_status", "list_sessions", "graph_walk"):
            with self.subTest(tool=name):
                self.assertEqual(agent_tools.call(name, {})["status"], "refused")
        self.assertTrue(agent_tools.call("get_live_reading", {"sensor": "ph"})["ok"])

    def test_simple_follows_the_track(self) -> None:
        tool_policy_store.set_mode("simple")
        fixtures.set_track("graph")
        self.assertEqual(self.available(), ANSWERING_VECTOR - {"search_corpus"} | {"graph_walk"})

    def test_simple_ignores_advanced_switches(self) -> None:
        tool_policy_store.set_mode("advanced")
        tool_policy_store.disable("get_trend")
        self.assertNotIn("get_trend", self.available())
        tool_policy_store.set_mode("simple")
        self.assertIn("get_trend", self.available())

    def test_advanced_offers_more_and_keeps_its_switches(self) -> None:
        tool_policy_store.set_mode("advanced")
        tool_policy_store.disable("get_current_time")
        wide = self.available()
        self.assertTrue(ANSWERING_VECTOR < wide)
        self.assertNotIn("get_current_time", wide)
        tool_policy_store.set_mode("simple")
        tool_policy_store.set_mode("advanced")
        self.assertNotIn("get_current_time", self.available())  # never rewritten by a mode change

    def test_setup_surface_is_not_gated_by_mode(self) -> None:
        tool_policy_store.set_mode("simple")
        env = agent_tools.call("get_current_time", {}, surface=agent_tools.Surface.SETUP)
        self.assertTrue(env["ok"])

    def test_fallback_sensor_set_matches_the_planner(self) -> None:
        from app.services.agent_tools import registry
        from app.services.orchestration import planner

        self.assertEqual(registry._FALLBACK_SENSOR_TOOLS, frozenset(planner.SENSOR_TOOLS))

    def test_unreadable_planner_keeps_only_the_named_sensor_tools(self) -> None:
        from unittest import mock

        from app.services.agent_tools import registry

        tool_policy_store.set_mode("simple")
        with mock.patch.object(registry, "_answering_names", return_value=None):
            sensors = {t["name"] for t in agent_tools.catalogue()["tools"]
                       if t["available"] and t["category"] == "sensor"}
            self.assertEqual(sensors, set(registry._FALLBACK_SENSOR_TOOLS))
            self.assertEqual(agent_tools.call("get_current_time", {})["status"], "refused")

    def test_bad_mode_is_rejected(self) -> None:
        with self.assertRaises(tool_policy_store.ToolPolicyError):
            tool_policy_store.set_mode("expert")


if __name__ == "__main__":
    unittest.main()
