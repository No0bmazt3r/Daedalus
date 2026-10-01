"""The whole of §7.1 through `inference.answer_stream`, with Ollama faked.

The fake streams a scripted answer, so these tests pin what the orchestrator
does *around* the model: which events arrive, what the transcript stores, what
the audit rows say — and above all that an answer with an invented number is
never what the operator is left reading.
"""

from __future__ import annotations

import contextlib
import json
import unittest
from unittest import mock

from app.db import audit_store, paths, sqlite_util
from app.services import chat_service, inference, ollama_client, orchestration

from . import fixtures


class _FakeResponse:
    status_code = 200

    def __init__(self, text: str) -> None:
        self.text = text

    def read(self) -> bytes:
        return b""

    def iter_lines(self):  # noqa: ANN201
        for word in self.text.split(" "):
            yield json.dumps({"message": {"content": word + " "}})
        yield json.dumps({"done": True, "prompt_eval_count": 100, "eval_count": 10})


class _FakeHttpx:
    # `ollama_client._timeout` builds one of these before every call.
    Timeout = staticmethod(lambda **_: None)

    def __init__(self, text: str) -> None:
        self.text = text
        self.payloads: list[dict] = []

    @contextlib.contextmanager
    def stream(self, method, url, json=None, timeout=None):  # noqa: ANN001, ANN201, A002
        self.payloads.append(json)
        yield _FakeResponse(self.text)


class ChatPathTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixtures.build()
        fixtures.set_track("vector")

    def run_turn(self, question: str, answer: str, *, fake: object | None = None) -> tuple[list[dict], _FakeHttpx]:
        fake = fake or _FakeHttpx(answer)
        session = chat_service.create_session()
        choice = {"tag": "fake:1b", "source": "pinned", "remote": False, "reason": "test"}
        # The title job is a background model call; here it is only counted.
        with mock.patch.object(ollama_client, "httpx", fake), \
             mock.patch.object(ollama_client, "candidate_base_urls", return_value=["http://fake"]), \
             mock.patch.object(ollama_client, "serving_host", return_value="test"), \
             mock.patch.object(inference, "choose_model", return_value=choice), \
             mock.patch.object(inference.session_titles, "schedule") as titled:
            events = list(inference.answer_stream(session["session_id"], question))
        self.session_id = session["session_id"]
        self.titled = titled
        return events, fake

    def done(self, events: list[dict]) -> dict:
        terminal = events[-1]
        self.assertEqual(terminal["phase"], "done", terminal)
        return terminal["result"]

    def test_grounded_answer_is_delivered_with_citations(self) -> None:
        events, fake = self.run_turn("What is the CO2 level now?",
                                     f"CO2 is {fixtures.co2(119)} ppm [S1], from a stale reading.")
        phases = [e["phase"] for e in events if e["phase"] != "generating"]
        self.assertEqual(phases, ["understood", "evidence", "validated", "done"])
        result = self.done(events)
        self.assertTrue(result["grounded"])
        self.assertEqual(result["tools_used"], ["get_live_reading"])
        self.assertEqual(result["citations"][0]["label"], "S1")
        # The prompt carried the evidence and the rules.
        messages = fake.payloads[0]["messages"]
        self.assertIn("EVIDENCE:", messages[-2]["content"])
        self.assertIn("Every number you write must appear", messages[0]["content"])

    def test_prefixed_citation_is_stored_in_the_plain_form(self) -> None:
        events, _ = self.run_turn("What is the CO2 level now?",
                                  f"[EVIDENCE: S1] CO2 is {fixtures.co2(119)} ppm.")
        result = self.done(events)
        self.assertTrue(result["grounded"])
        self.assertTrue(result["message"]["content"].startswith("[S1]"))

    def test_invented_number_is_replaced_by_the_fallback(self) -> None:
        events, _ = self.run_turn("What is the CO2 level now?", "CO2 is 777.7 ppm [S1].")
        result = self.done(events)
        self.assertEqual(result["answer"], orchestration.FALLBACK)
        self.assertEqual(result["message"]["content"], orchestration.FALLBACK)
        self.assertFalse(result["grounded"])
        self.assertEqual(result["validation"]["unsupported_numbers"], ["777.7"])

        row = audit_store.trace(result["query_id"])["conversation_logs"][0]
        self.assertEqual(row["response_text"], orchestration.FALLBACK)
        self.assertEqual(row["model_response_text"].strip(), "CO2 is 777.7 ppm [S1].")
        self.assertEqual(row["hallucination_flag"], 1)
        self.assertEqual(row["grounded_flag"], 0)

    def test_every_step_is_on_one_query_id(self) -> None:
        events, _ = self.run_turn("Average temperature over the last hour?",
                                  "The average was about 29 °C [S1].")
        trace = audit_store.trace(self.done(events)["query_id"])
        self.assertEqual(len(trace["conversation_logs"]), 1)
        self.assertEqual([r["tool_name"] for r in trace["tool_logs"]], ["get_trend"])
        self.assertEqual(len(trace["model_logs"]), 1)
        self.assertEqual(trace["conversation_logs"][0]["intent"], "trend_query")

    def test_control_request_never_reaches_a_model_or_tool(self) -> None:
        events, fake = self.run_turn("Open ABV-1", "Done, ABV-1 is now open.")
        result = self.done(events)
        self.assertEqual(fake.payloads, [])
        self.assertIsNone(result["model"])
        trace = audit_store.trace(result["query_id"])
        self.assertNotIn("tool_logs", trace)
        self.assertEqual(trace["conversation_logs"][0]["guard_reason"], "control_command")

    def test_unplaceable_time_asks_without_a_model(self) -> None:
        events, fake = self.run_turn("What was the max CO2 during the last run?", "unused")
        result = self.done(events)
        self.assertEqual(fake.payloads, [])
        self.assertIn("Which time do you mean", result["answer"])

    def test_evidence_is_stored_but_never_replayed(self) -> None:
        events, fake = self.run_turn("What is the CO2 level now?", f"CO2 is {fixtures.co2(119)} ppm [S1].")
        stored = self.done(events)["message"]
        self.assertTrue(stored["evidence"]["citations"])
        window = chat_service.build_context(self.session_id)
        replayed = "\n".join(m["content"] for m in window.as_prompt_messages())
        # Words that only occur in an evidence line, never in the answer.
        self.assertNotIn("Reading at", replayed)
        self.assertNotIn("get_live_reading", replayed)

    def test_prompt_size_and_context_are_logged_on_the_query(self) -> None:
        events, fake = self.run_turn("What is the CO2 level now?", f"CO2 is {fixtures.co2(119)} ppm [S1].")
        result = self.done(events)
        trace = audit_store.trace(result["query_id"])
        sent = sum(len(m["content"]) for m in fake.payloads[0]["messages"])
        self.assertEqual(trace["model_logs"][0]["prompt_chars"], sent)
        context = trace["memory_logs"][0]
        self.assertEqual(context["kind"], "context")
        self.assertEqual(context["session_id"], self.session_id)
        self.assertIn('"chars_per_token"', context["content"])
        self.titled.assert_called_once_with(self.session_id)

    def test_failed_model_call_writes_an_error_row(self) -> None:
        class _Broken(_FakeHttpx):
            @contextlib.contextmanager
            def stream(self, method, url, json=None, timeout=None):  # noqa: ANN001, ANN201, A002
                raise ollama_client.OllamaError("model exploded")
                yield  # pragma: no cover

        events, _ = self.run_turn("What is the CO2 level now?", "", fake=_Broken(""))
        self.assertEqual(events[-1]["phase"], "error")
        errors = [r for r in audit_store.trace(self._last_query_id())["error_logs"]]
        self.assertEqual(errors[0]["component"], "inference")
        self.assertEqual(errors[0]["error_type"], "OllamaError")
        self.assertIn("model exploded", errors[0]["message"])

    def _last_query_id(self) -> str:
        with sqlite_util.connect(paths.AUDIT_DB) as conn:
            return conn.execute(
                "SELECT query_id FROM conversation_logs WHERE session_id = ? ORDER BY id DESC LIMIT 1",
                (self.session_id,),
            ).fetchone()["query_id"]

    def test_feedback_is_appended_and_the_newest_wins(self) -> None:
        from fastapi.testclient import TestClient  # noqa: PLC0415

        from app.main import app  # noqa: PLC0415

        events, _ = self.run_turn("What is the CO2 level now?", f"CO2 is {fixtures.co2(119)} ppm [S1].")
        qid = self.done(events)["query_id"]
        client = TestClient(app)
        body = {"query_id": qid, "session_id": self.session_id}
        self.assertEqual(client.post("/api/chat/feedback", json={**body, "rating": 1}).status_code, 200)
        self.assertEqual(client.post("/api/chat/feedback", json={**body, "rating": -1}).status_code, 200)
        ratings = client.get("/api/chat/feedback", params={"session_id": self.session_id}).json()["ratings"]
        self.assertEqual(ratings, {qid: -1})
        self.assertEqual(len(audit_store.trace(qid)["feedback_logs"]), 2)
        client.post("/api/chat/feedback", json={**body, "rating": 0})
        self.assertEqual(client.get("/api/chat/feedback", params={"session_id": self.session_id}).json()["ratings"], {})
        self.assertEqual(client.post("/api/chat/feedback", json={**body, "query_id": "q_nope", "rating": 1}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
