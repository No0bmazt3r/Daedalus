"""M3: the sensor tools are read-only, whitelisted and bounded."""

from __future__ import annotations

import sqlite3
import unittest

from app.db import sensor_store
from app.services import agent_tools
from app.services.agent_tools import registry

from . import fixtures

_UNSAFE_EFFECTS = {
    agent_tools.Effect.WRITE, agent_tools.Effect.ADMIN,
    agent_tools.Effect.EXECUTE_CODE, agent_tools.Effect.NETWORK_EGRESS,
}
SENSOR_TOOLS = ("get_live_reading", "get_trend")


class SensorToolTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixtures.build()

    def call(self, name: str, **args):  # noqa: ANN001, ANN201
        return agent_tools.call(name, args)

    # ── no write signature ──────────────────────────────────────────────────

    def test_sensor_tools_declare_only_read_sensor(self) -> None:
        for name in SENSOR_TOOLS:
            with self.subTest(tool=name):
                self.assertEqual(agent_tools.get(name).effects, frozenset({agent_tools.Effect.READ_SENSOR}))

    def test_no_tool_the_orchestrator_plans_has_a_write_effect(self) -> None:
        for name in SENSOR_TOOLS + ("search_corpus", "graph_walk"):
            with self.subTest(tool=name):
                self.assertFalse(agent_tools.get(name).effects & _UNSAFE_EFFECTS)

    def test_the_store_itself_refuses_writes(self) -> None:
        with sensor_store.connect_ro() as conn, self.assertRaises(sqlite3.OperationalError):
            conn.execute("DELETE FROM sensor_readings")

    # ── whitelisting and injection ──────────────────────────────────────────

    def test_unknown_sensor_is_rejected(self) -> None:
        for bad in ("temp_c", "humidity", "co2_ppm; DROP TABLE sensor_readings", "*"):
            with self.subTest(sensor=bad):
                env = self.call("get_live_reading", sensor=bad)
                self.assertFalse(env["ok"])
                self.assertEqual(env["status"], "invalid_arguments")

    def test_unknown_aggregation_is_rejected(self) -> None:
        env = self.call("get_trend", sensor="ph", start_time="2026-09-12T10:00:00Z",
                        end_time="2026-09-12T11:00:00Z", aggregation="median")
        self.assertEqual(env["status"], "invalid_arguments")

    def test_injection_through_a_timestamp_fails(self) -> None:
        for bad in ("2026-09-12' OR '1'='1", "1; DROP TABLE sensor_readings", "now()"):
            with self.subTest(ts=bad):
                env = self.call("get_live_reading", sensor="ph", timestamp=bad)
                self.assertFalse(env["ok"])
                self.assertNotIn("sqlite", env["detail"].lower())
        with sensor_store.connect_ro() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM sensor_readings").fetchone()[0],
                             fixtures.MINUTES)

    def test_unknown_argument_is_an_error(self) -> None:
        env = self.call("get_live_reading", sensor="ph", sensor_name="ph")
        self.assertEqual(env["status"], "invalid_arguments")

    # ── behaviour ───────────────────────────────────────────────────────────

    def test_latest_reading_is_marked_stale(self) -> None:
        env = self.call("get_live_reading", sensor="co2_ppm")
        self.assertTrue(env["ok"])
        self.assertEqual(env["data"]["timestamp"], "2026-09-12T11:59:00+00:00")
        self.assertEqual(env["data"]["value"], fixtures.co2(119))
        self.assertTrue(env["data"]["stale"])

    def test_historical_reading_is_the_nearest_row(self) -> None:
        env = self.call("get_live_reading", sensor="co2_ppm", timestamp="2026-09-12T10:31:20Z")
        self.assertEqual(env["data"]["timestamp"], "2026-09-12T10:31:00+00:00")
        self.assertEqual(env["data"]["value"], fixtures.co2(31))
        self.assertEqual(env["data"]["offset_seconds"], -20)

    def test_historical_reading_outside_tolerance_is_not_found(self) -> None:
        env = self.call("get_live_reading", sensor="ph", timestamp="2026-09-12T14:00:00Z")
        self.assertTrue(env["ok"])
        self.assertFalse(env["data"]["found"])

    def test_trend_statistics(self) -> None:
        env = self.call("get_trend", sensor="co2_ppm", start_time="2026-09-12T10:00:00Z",
                        end_time="2026-09-12T11:59:00Z", aggregation="max")
        data = env["data"]
        self.assertEqual(data["sample_count"], fixtures.MINUTES)
        self.assertEqual(data["value"], fixtures.co2(34))
        self.assertEqual(data["max_at"], "2026-09-12T10:34:00+00:00")
        self.assertLessEqual(len(data["series"]), 100)
        # The spike survives downsampling.
        self.assertIn(fixtures.co2(34), [p["value"] for p in data["series"]])

    def test_trend_mode_filter(self) -> None:
        env = self.call("get_trend", sensor="temperature", start_time="2026-09-12T10:00:00Z",
                        end_time="2026-09-12T12:00:00Z", aggregation="count", mode_filter="Desorption")
        self.assertEqual(env["data"]["value"], 60)

    def test_reversed_window_is_an_error(self) -> None:
        env = self.call("get_trend", sensor="ph", start_time="2026-09-12T11:00:00Z",
                        end_time="2026-09-12T10:00:00Z")
        self.assertFalse(env["ok"])

if __name__ == "__main__":
    unittest.main()
