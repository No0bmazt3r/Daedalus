"""Ariadne's Thread — real turns through the chat path, read back as traces.

What is pinned: the chain comes back in pipeline order on one query id; the
number-by-number verdict agrees with the validator that ran at answer time; and
a trace still reads (without its evidence) once the chat it came from is gone.
"""

from __future__ import annotations

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.db import audit_store
from app.main import app
from app.services import chat_service, inference, ollama_client, orchestration, thread

from . import fixtures
from .test_chat_path import _FakeHttpx


class ThreadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixtures.build()
        fixtures.set_track("vector")
        cls.client = TestClient(app)

    def turn(self, question: str, answer: str) -> tuple[str, str]:
        """Run one chat turn; returns (query_id, session_id)."""
        session = chat_service.create_session()
        choice = {"tag": "fake:1b", "source": "pinned", "remote": False, "reason": "test"}
        with mock.patch.object(ollama_client, "httpx", _FakeHttpx(answer)), \
             mock.patch.object(ollama_client, "candidate_base_urls", return_value=["http://fake"]), \
             mock.patch.object(ollama_client, "serving_host", return_value="test"), \
             mock.patch.object(inference, "choose_model", return_value=choice), \
             mock.patch.object(inference.session_titles, "schedule"):
            events = list(inference.answer_stream(session["session_id"], question))
        self.assertEqual(events[-1]["phase"], "done", events[-1])
        return events[-1]["result"]["query_id"], session["session_id"]

    def test_grounded_turn_reads_in_pipeline_order(self) -> None:
        reading = fixtures.co2(119)
        qid, _ = self.turn("What is the CO2 level now?", f"CO2 is {reading} ppm [S1].")
        body = self.client.get(f"/api/trace/{qid}").json()
        kinds = [s["kind"] for s in body["steps"]]
        self.assertEqual(
            kinds, ["query", "understanding", "tool", "evidence", "context", "model", "validation", "answer"],
        )
        self.assertEqual(body["summary"]["status"], "grounded")
        self.assertTrue(body["evidence_available"])
        tool = body["steps"][2]
        self.assertEqual(tool["title"], "get_live_reading")
        self.assertIsInstance(tool["detail"]["input"], dict)
        self.assertIn("S1", body["steps"][3]["detail"]["lines"])

        check = self.client.get(f"/api/trace/{qid}/groundedness").json()
        [mark] = check["numbers"]
        self.assertEqual(mark["verdict"], "supported")
        self.assertEqual(mark["sources"][0]["label"], "S1")
        self.assertEqual(check["answer"][mark["start"]:mark["end"]], str(reading))
        self.assertEqual(check["citations"][0]["label"], "S1")

    def test_invented_number_is_red_and_the_model_text_is_judged(self) -> None:
        qid, _ = self.turn("What is the CO2 level now?", "CO2 is 777.7 ppm [S1].")
        check = thread.groundedness(qid)
        self.assertEqual(check["status"], "blocked")
        self.assertTrue(check["replaced"])
        self.assertEqual(check["delivered"], orchestration.FALLBACK)
        self.assertIn("777.7", check["answer"])
        self.assertEqual([m["verdict"] for m in check["numbers"]], ["unsupported"])
        self.assertEqual(check["counts"], {"unsupported": 1})

    def test_small_count_is_not_a_claim(self) -> None:
        reading = fixtures.co2(119)
        qid, _ = self.turn("What is the CO2 level now?", f"CO2 is {reading} ppm [S1], from 1 reading.")
        verdicts = {m["text"]: m["verdict"] for m in thread.groundedness(qid)["numbers"]}
        self.assertEqual(verdicts, {str(reading): "supported", "1": "not_a_claim"})

    def test_refusal_has_no_tools_and_nothing_checked(self) -> None:
        qid, _ = self.turn("Open ABV-1", "unused")
        body = thread.trace(qid)
        self.assertEqual(body["summary"]["status"], "refused")
        self.assertNotIn("tool", [s["kind"] for s in body["steps"]])
        self.assertEqual(body["steps"][1]["status"], "refused")
        check = thread.groundedness(qid)
        self.assertIsNone(check["validation"])
        self.assertTrue(all(m["verdict"] == "unchecked" for m in check["numbers"]))

    def test_trace_outlives_a_deleted_chat(self) -> None:
        reading = fixtures.co2(119)
        qid, session_id = self.turn("What is the CO2 level now?", f"CO2 is {reading} ppm [S1].")
        chat_service.delete_session(session_id)
        body = thread.trace(qid)
        self.assertFalse(body["evidence_available"])
        self.assertNotIn("evidence", [s["kind"] for s in body["steps"]])
        # The stored verdict still decides; only the source line is gone.
        [mark] = thread.groundedness(qid)["numbers"]
        self.assertEqual((mark["verdict"], mark["sources"]), ("supported", []))

    def test_list_filters(self) -> None:
        good, session_id = self.turn("What is the CO2 level now?", f"CO2 is {fixtures.co2(119)} ppm [S1].")
        bad, _ = self.turn("What is the CO2 level now?", "CO2 is 777.7 ppm [S1].")
        mine = self.client.get("/api/trace", params={"session_id": session_id}).json()
        self.assertEqual([i["query_id"] for i in mine["items"]], [good])
        self.assertEqual(mine["total"], 1)
        self.assertEqual(mine["items"][0]["tool_count"], 1)
        grounded = {i["query_id"] for i in self.client.get("/api/trace", params={"grounded": "yes", "limit": 500}).json()["items"]}
        self.assertIn(good, grounded)
        self.assertNotIn(bad, grounded)
        found = self.client.get("/api/trace", params={"q": bad}).json()["items"]
        self.assertEqual([i["query_id"] for i in found], [bad])
        self.assertEqual(self.client.get("/api/trace", params={"grounded": "maybe"}).status_code, 422)

    def test_unknown_query_is_404(self) -> None:
        self.assertEqual(self.client.get("/api/trace/q_nope").status_code, 404)
        self.assertEqual(self.client.get("/api/trace/q_nope/groundedness").status_code, 404)

    def test_retrieval_sits_under_the_tool_that_ran_it(self) -> None:
        qid = audit_store.new_query_id()
        audit_store.log("conversation_logs", query_id=qid, user_query="why?", intent="document_query")
        audit_store.log("tool_logs", query_id=qid, tool_name="get_live_reading", status="ok", latency_ms=3)
        audit_store.log("tool_logs", query_id=qid, tool_name="search_corpus", status="ok", latency_ms=40)
        audit_store.log("rag_logs", query_id=qid, track="vector", top_k=5,
                        retrieved_chunk_ids=["c1", "c2"], retrieval_latency_ms=30, rerank_latency_ms=8)
        steps = thread.trace(qid)["steps"]
        self.assertEqual([s["kind"] for s in steps][2:5], ["tool", "tool", "retrieval"])
        retrieval = steps[4]
        self.assertEqual(retrieval["ms"], 38)
        self.assertEqual(retrieval["detail"]["chunk_ids"], ["c1", "c2"])


if __name__ == "__main__":
    unittest.main()
