"""§7.4's rolling summary: folds what fell out of the window, never keeps a value."""

from __future__ import annotations

import unittest
from unittest import mock

from app.db import paths, sqlite_util
from app.services import chat_service, summariser
from app.services.query_pipeline import local_model

# ~150 tokens each at the store's estimate, so a dozen overflow the 1200 budget.
LONG = "Tell me about the absorber outlet NDIR analyser and how it behaves. " * 9


def _session_with_overflow() -> str:
    sid = chat_service.create_session()["session_id"]
    for i in range(12):
        chat_service.add_user_message(sid, f"Question {i}: {LONG}")
        chat_service.add_assistant_message(sid, f"CO2 was 61{i}.4 ppm then. {LONG}")
    return sid


class SummariserTest(unittest.TestCase):
    def test_folds_dropped_turns_and_redacts_values(self) -> None:
        sid = _session_with_overflow()
        before = chat_service.build_context(sid)
        self.assertTrue(before.needs_summary)

        reply = ({"summary": "The operator asked about the NDIR, which read 612.4 ppm, and ABV-1."}, "fake:1b")
        with mock.patch.object(local_model, "ask_json", return_value=reply):
            result = summariser.summarise(sid)

        self.assertEqual(result["method"], "model")
        self.assertEqual(result["upto_seq"], before.oldest_kept_seq - 1)
        self.assertNotIn("612.4", result["summary"])
        self.assertIn("ABV-1", result["summary"])  # an identifier, not a value

        after = chat_service.build_context(sid)
        self.assertEqual(after.dropped, 0)
        self.assertEqual(after.summary, result["summary"])
        self.assertIn("Summary of earlier conversation", after.as_prompt_messages()[0]["content"])

    def test_falls_back_to_the_operators_questions_without_a_model(self) -> None:
        sid = _session_with_overflow()
        with mock.patch.object(local_model, "ask_json", return_value=(None, None)):
            result = summariser.summarise(sid)
        self.assertEqual(result["method"], "fallback")
        self.assertIn("Earlier the operator asked", result["summary"])
        self.assertNotRegex(result["summary"], r"61\d\.4")

    def test_nothing_to_fold_is_a_no_op(self) -> None:
        sid = chat_service.create_session()["session_id"]
        chat_service.add_user_message(sid, "What is the CO2 now?")
        with mock.patch.object(local_model, "ask_json", side_effect=AssertionError("model called")):
            self.assertIsNone(summariser.summarise(sid))

    def test_every_run_is_logged(self) -> None:
        sid = _session_with_overflow()
        with mock.patch.object(local_model, "ask_json", return_value=(None, None)):
            summariser.summarise(sid)
        with sqlite_util.connect(paths.AUDIT_DB) as conn:
            rows = conn.execute(
                "SELECT kind, source FROM memory_logs WHERE session_id = ?", (sid,)
            ).fetchall()
        self.assertEqual([r["kind"] for r in rows], ["summary"])
        self.assertTrue(rows[0]["source"].startswith("fallback:"))

    def test_one_pass_per_session_at_a_time(self) -> None:
        with mock.patch.object(summariser, "summarise", side_effect=lambda _sid: __import__("time").sleep(0.2)):
            self.assertTrue(summariser.schedule("s-x"))
            self.assertFalse(summariser.schedule("s-x"))


if __name__ == "__main__":
    unittest.main()
