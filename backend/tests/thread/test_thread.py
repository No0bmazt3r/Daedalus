"""Ariadne's Thread — real turns through the chat path, read back as traces.

What is pinned: the chain comes back in pipeline order on one query id; the
number-by-number verdict agrees with the validator that ran at answer time; and
a trace still reads (without its evidence) once the chat it came from is gone.
"""

from __future__ import annotations

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.db import audit_store, migrations
from app.main import app
from app.services import chat_service, inference, ollama_client, orchestration, thread, thread_settings

from .. import fixtures
from ..fakes import FakeHttpx


class ThreadTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixtures.build()
        fixtures.set_track("vector")
        # The corpus store's schema is applied at app start-up, which a bare
        # TestClient does not run; the retrieval join reads it.
        migrations.migrate("corpus")
        cls.client = TestClient(app)

    def tearDown(self) -> None:
        thread_settings.write({"reset": True})

    def turn(self, question: str, answer: str, *, incognito: bool = False) -> tuple[str, str]:
        """Run one chat turn; returns (query_id, session_id)."""
        session = chat_service.create_session(ephemeral=incognito)
        choice = {"tag": "fake:1b", "source": "pinned", "remote": False, "reason": "test"}
        with mock.patch.object(ollama_client, "httpx", FakeHttpx(answer)), \
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
        self.assertFalse(body["summary"]["chat"]["exists"])
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
        chat = mine["items"][0]["chat"]
        self.assertEqual((chat["session_id"], chat["exists"]), (session_id, True))
        grounded = {i["query_id"] for i in self.client.get("/api/trace", params={"bucket": "grounded", "limit": 500}).json()["items"]}
        self.assertIn(good, grounded)
        self.assertNotIn(bad, grounded)
        found = self.client.get("/api/trace", params={"q": bad}).json()["items"]
        self.assertEqual([i["query_id"] for i in found], [bad])
        self.assertEqual(self.client.get("/api/trace", params={"bucket": "maybe"}).status_code, 422)

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


    def test_label_is_appended_and_the_newest_wins(self) -> None:
        qid, _ = self.turn("What is the CO2 level now?", f"CO2 is {fixtures.co2(119)} ppm [S1].")
        put = lambda body: self.client.put(f"/api/trace/{qid}/label", json=body)  # noqa: E731
        self.assertTrue(put({"hallucinated": True, "note": "wrong sensor"}).json()["label"]["hallucinated"])
        second = put({"hallucinated": False}).json()["label"]
        self.assertEqual((second["hallucinated"], second["note"]), (False, None))
        self.assertEqual(thread.trace(qid)["summary"]["label"]["hallucinated"], False)
        self.assertEqual(thread.trace(qid)["steps"][-1]["kind"], "label")
        self.assertIsNone(put({"hallucinated": None}).json()["label"])
        self.assertIsNone(thread.trace(qid)["summary"]["label"])
        self.assertEqual(self.client.put("/api/trace/q_nope/label", json={"hallucinated": True}).status_code, 404)
        # A label is human judgement, not a thumbs rating.
        self.assertEqual(audit_store.latest_ratings(thread.trace(qid)["summary"]["session_id"]), {})

    def test_incognito_turn_keeps_no_text(self) -> None:
        reading = fixtures.co2(119)
        qid, _ = self.turn("What is the CO2 level now?", f"CO2 is {reading} ppm [S1].", incognito=True)
        rows = audit_store.trace(qid)
        convo = rows["conversation_logs"][0]
        self.assertEqual(convo["user_query"], audit_store.REDACTED)
        self.assertEqual(convo["response_text"], audit_store.REDACTED)
        self.assertEqual(convo["standalone_query"], audit_store.REDACTED)
        self.assertEqual(convo["grounded_flag"], 1)  # the verdict is still evidence
        self.assertTrue(all(t["tool_input_json"] == audit_store.REDACTED for t in rows["tool_logs"]))
        self.assertTrue(thread.trace(qid)["summary"]["chat"]["incognito"])
        check = thread.groundedness(qid)
        self.assertTrue(check["redacted"])
        self.assertEqual(check["numbers"], [])
        # An ordinary chat after it is recorded as usual: the flag was this turn's only.
        other, _ = self.turn("What is the CO2 level now?", f"CO2 is {reading} ppm [S1].")
        self.assertEqual(audit_store.trace(other)["conversation_logs"][0]["user_query"], "What is the CO2 level now?")

    def test_prompt_hash_is_logged(self) -> None:
        qid, _ = self.turn("What is the CO2 level now?", f"CO2 is {fixtures.co2(119)} ppm [S1].")
        model = next(s for s in thread.trace(qid)["steps"] if s["kind"] == "model")
        self.assertRegex(model["detail"]["prompt_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(model["table"], "model_logs")

    def test_settings_move_turns_between_buckets(self) -> None:
        qid, session_id = self.turn("What is the CO2 level now?", "CO2 is 777.7 ppm [S1].")
        bucket = lambda: self.client.get("/api/trace", params={"session_id": session_id}).json()["items"][0]["bucket"]  # noqa: E731
        self.assertEqual(bucket(), "ungrounded")  # blocked files under Not grounded by default
        r = self.client.put("/api/trace/settings", json={"buckets": {"blocked": "unchecked"}, "labels": {"unchecked": "No verdict"}})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(bucket(), "unchecked")
        self.assertEqual(self.client.get("/api/trace").json()["labels"]["unchecked"], "No verdict")
        self.assertEqual(self.client.put("/api/trace/settings", json={"buckets": {"blocked": "maybe"}}).status_code, 422)
        self.assertEqual(self.client.put("/api/trace/settings", json={"labels": {"grounded": " "}}).status_code, 422)

    def test_grounded_without_citation_when_not_required(self) -> None:
        qid, session_id = self.turn("What is the CO2 level now?", "There is a reading available.")
        first = lambda: self.client.get("/api/trace", params={"session_id": session_id}).json()["items"][0]  # noqa: E731
        self.assertEqual(first()["status"], "ungrounded")
        thread_settings.write({"require_citation": False})
        self.assertEqual(first()["status"], "grounded")
        self.assertFalse(first()["grounded"])  # the stored verdict is unchanged

    def test_stats_cover_every_match_not_just_the_page(self) -> None:
        good, session_id = self.turn("What is the CO2 level now?", f"CO2 is {fixtures.co2(119)} ppm [S1].")
        body = self.client.get("/api/trace", params={"limit": 1}).json()
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["stats"]["total"], body["total"])
        self.assertGreater(body["stats"]["total"], 1)
        self.assertIsNotNone(body["stats"]["latency_p95_ms"])
        self.assertEqual(sum(body["stats"]["by_bucket"].values()), body["total"])


    def test_status_filter_is_exact(self) -> None:
        refused, session_id = self.turn("Open ABV-1", "unused")
        statuses = {i["status"] for i in self.client.get("/api/trace", params={"status": "refused", "limit": 500}).json()["items"]}
        self.assertEqual(statuses, {"refused"})
        self.assertEqual(self.client.get("/api/trace", params={"status": "maybe"}).status_code, 422)

    def test_retrieval_detail_for_both_tracks(self) -> None:
        qid = audit_store.new_query_id()
        audit_store.log("conversation_logs", query_id=qid, user_query="why?", intent="document_query")
        audit_store.log("rag_logs", query_id=qid, track="vector", top_k=2, vector_db_used="daedalus_nomic",
                        retrieved_chunk_ids=["gone_1", "gone_2"], retrieval_scores=[0.21, 0.4],
                        rerank_scores=[3.5, -1.0], retrieved_origins=["rig", "reference"],
                        rerank_model="minilm", candidate_count=20)
        audit_store.log("rag_logs", query_id=qid, track="graph", hop_count=1, entry_strategy="alias",
                        traversal_path={"entry_nodes": ["sensor:co2"], "hops": [
                            {"hop": 1, "from": ["sensor:co2"], "edge": "HAS_THRESHOLD", "to": ["threshold:nope"],
                             "edges": [], "sufficient": True, "reason": "enough"}]})
        body = self.client.get(f"/api/trace/{qid}/retrieval").json()
        vector, graph = body["retrievals"]
        self.assertEqual(vector["track"], "vector")
        first = vector["chunks"][0]
        # Re-chunked away since: reported, not dropped, with what the log kept.
        self.assertEqual((first["rank"], first["missing"], first["distance"], first["rerank_score"], first["origin"]),
                         (1, True, 0.21, 3.5, "rig"))
        self.assertEqual((vector["rerank_model"], vector["candidates"]), ("minilm", 20))
        self.assertEqual(graph["entry_strategy"], "alias")
        self.assertEqual([n["id"] for n in graph["nodes"]], ["sensor:co2", "threshold:nope"])
        self.assertTrue(graph["nodes"][1]["missing"])
        self.assertEqual(self.client.get("/api/trace/q_nope/retrieval").status_code, 404)

    def test_graph_citation_keeps_its_evidence_label(self) -> None:
        from app.services.orchestration.evidence import EvidenceItem, EvidencePack  # noqa: PLC0415
        pack = EvidencePack(items=[EvidenceItem("G1", "graph", "graph_walk", "[G1] x",
                                                {"type": "graph", "node_id": "sensor:co2", "name": "CO2"})])
        [c] = pack.citations()
        self.assertEqual((c["label"], c["name"]), ("G1", "CO2"))


if __name__ == "__main__":
    unittest.main()
