"""Track 2's agent loop, driven by a scripted model — no Ollama anywhere."""

from __future__ import annotations

import json
import re
import time
import unittest
from typing import Any
from unittest import mock

from app.db import audit_store
from app.services import agent_tools, graph_agent, rag_config
from app.services.agent_tools import search
from app.services.orchestration import planner

from .. import fixtures

BOTH_SPIKED = "pressure and temperature both spiked, what do I do?"


def script(*steps: Any, delay: float = 0.0):  # noqa: ANN201
    """An `ask` that plays `steps` in order.

    A step is an edge name (walk that move, from all its nodes), `("STOP", verdict)`,
    or a raw dict sent back unchanged. Moves are numbered per prompt, so an edge
    name is resolved against the prompt the loop actually sent.
    """
    queue = list(steps)
    prompts: list[str] = []

    def ask(system: str, prompt: str, **_: Any) -> tuple[dict[str, Any] | None, str]:
        prompts.append(prompt)
        if delay:
            time.sleep(delay)
        step = queue.pop(0) if queue else ("STOP", True)
        if isinstance(step, dict):
            return step, "fake"
        if isinstance(step, tuple):
            return {"move": 0, "sufficient": step[1], "reason": "scripted stop"}, "fake"
        number = re.search(rf"^(\d+)\. \w+ --{step}-->", prompt, re.M)
        assert number, f"{step} not offered in:\n{prompt}"
        return {"move": int(number.group(1)), "sufficient": False,
                "reason": f"walk {step}"}, "fake"

    ask.prompts = prompts  # type: ignore[attr-defined]
    return ask


def run(query: str, ask: Any, **kw: Any) -> dict[str, Any]:
    return graph_agent.run(query, ask=ask, tag="fake", **kw)["data"]


class AgentLoopTest(unittest.TestCase):
    def test_model_chosen_multi_hop_reaches_the_procedure(self) -> None:
        data = run(BOTH_SPIKED, script("HAS_THRESHOLD", "TRIGGERS", "RESOLVED_BY", "CONTAINS"))
        path = data["path"]
        self.assertEqual([h["edge"] for h in path["hops"]],
                         ["HAS_THRESHOLD", "TRIGGERS", "RESOLVED_BY", "CONTAINS"])
        self.assertEqual((path["mode"], path["stop_reason"], path["model"]), ("agent", "step_limit", "fake"))
        self.assertIn("SOPStep", {n["type"] for n in data["nodes"]})
        # Each verdict lands on the hop it judged; the last hop is never judged.
        self.assertEqual([h["sufficient"] for h in path["hops"]], [False, False, False, None])

    def test_stops_when_the_model_says_it_has_enough(self) -> None:
        path = run("emergency cooldown steps", script("CONTAINS", ("STOP", True)))["path"]
        self.assertEqual(path["stop_reason"], "sufficient")
        self.assertEqual(path["hop_count"], 1)
        self.assertTrue(path["hops"][0]["sufficient"])
        self.assertEqual(path["model_calls"], 2)

    def test_unusable_replies_are_rejected_not_acted_on(self) -> None:
        path = run(BOTH_SPIKED, script({"move": 99}, {"move": "first"}))["path"]
        self.assertEqual(path["stop_reason"], "invalid_replies")
        self.assertEqual(path["hop_count"], 0)
        self.assertEqual(len(path["rejected"]), 2)

    def test_one_bad_reply_is_recovered_from(self) -> None:
        path = run(BOTH_SPIKED, script({"move": 99}, "HAS_THRESHOLD", ("STOP", True)))["path"]
        self.assertIn("not offered", path["rejected"][0]["problem"])
        self.assertEqual([h["edge"] for h in path["hops"]], ["HAS_THRESHOLD"])

    def test_sufficient_ends_the_loop_whatever_move_came_with_it(self) -> None:
        enough = {"move": 1, "sufficient": True, "reason": "the threshold answers it"}
        path = run("what is the high limit for co2", script("HAS_THRESHOLD", enough))["path"]
        self.assertEqual((path["stop_reason"], path["hop_count"]), ("sufficient", 1))
        self.assertTrue(path["hops"][0]["sufficient"])

    def test_the_budget_ends_the_loop(self) -> None:
        path = run(BOTH_SPIKED, script("HAS_THRESHOLD", "TRIGGERS", delay=0.5), budget_s=1.0)["path"]
        self.assertEqual(path["stop_reason"], "budget")
        self.assertLessEqual(path["hop_count"], 2)

    def test_a_call_that_overruns_is_abandoned_at_the_deadline(self) -> None:
        # A cold model load: the call outlives the whole budget.
        started = time.perf_counter()
        path = run(BOTH_SPIKED, script("HAS_THRESHOLD", delay=3.0), budget_s=1.0)["path"]
        self.assertLess(time.perf_counter() - started, 1.5)
        self.assertEqual((path["stop_reason"], path["hop_count"]), ("budget", 0))

    def test_offered_moves_never_repeat_a_walk(self) -> None:
        ask = script("HAS_THRESHOLD", ("STOP", True))
        run(BOTH_SPIKED, ask)
        self.assertRegex(ask.prompts[0], r"--HAS_THRESHOLD-->")
        self.assertNotRegex(ask.prompts[1], r"Sensor --HAS_THRESHOLD-->")

    def test_no_local_model_falls_back_to_the_walk_and_says_so(self) -> None:
        with mock.patch.object(graph_agent.local_model, "local_tag", return_value=None):
            path = graph_agent.run(BOTH_SPIKED)["data"]["path"]
        self.assertEqual((path["mode"], path["stop_reason"]), ("walk", "no_local_model"))

    def test_nothing_matched_asks_no_model(self) -> None:
        ask = script()
        path = run("radiation shielding thickness", ask)["path"]
        self.assertEqual(path["stop_reason"], "no_entry_points")
        self.assertEqual(ask.prompts, [])


class AgentWiringTest(unittest.TestCase):
    def tearDown(self) -> None:
        fixtures.set_track("vector")

    def test_one_replayable_rag_row_through_dispatch(self) -> None:
        fixtures.set_track("graph", graph_mode="agent")
        query_id = audit_store.new_query_id()
        with mock.patch.object(graph_agent.local_model, "local_tag", return_value="fake"), \
             mock.patch.object(graph_agent.local_model, "ask_json",
                               script("HAS_THRESHOLD", ("STOP", True))):
            env = agent_tools.call("graph_agent", {"query": BOTH_SPIKED}, query_id=query_id)
        self.assertTrue(env["ok"], env["detail"])
        rows = audit_store.trace(query_id)["rag_logs"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(json.loads(rows[0]["traversal_path"])["mode"], "agent")

    def test_the_mode_decides_what_track_2_plans(self) -> None:
        for mode, tool in (("agent", "graph_agent"), ("walk", "graph_walk")):
            with self.subTest(mode=mode):
                fixtures.set_track("graph", graph_mode=mode)
                self.assertEqual(planner.answering_tools()["retrieval"], tool)
                self.assertIn(tool, agent_tools.catalogue()["answering"]["tools"])

    def test_track_1_refuses_the_agent(self) -> None:
        fixtures.set_track("vector")
        self.assertEqual(agent_tools.call("graph_agent", {"query": "x"})["status"], "refused")

    def test_default_mode_is_the_agent(self) -> None:
        self.assertEqual(rag_config.DEFAULT["graph"]["mode"], "agent")

    def test_bad_settings_are_refused(self) -> None:
        for bad in ({"mode": "random"}, {"budget_s": 0.1}, {"max_steps": 9}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                rag_config.write(graph=bad)


class FixedWalkTest(unittest.TestCase):
    def test_the_walk_follows_the_whole_chain(self) -> None:
        path = search.graph_walk(BOTH_SPIKED, 6)["data"]["path"]
        self.assertEqual([h["edge"] for h in path["hops"]],
                         ["HAS_THRESHOLD", "TRIGGERS", "RESOLVED_BY", "CONTAINS"])
        self.assertEqual(path["mode"], "walk")


if __name__ == "__main__":
    unittest.main()
