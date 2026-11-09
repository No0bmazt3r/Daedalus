"""Background job runs: done, skipped with a reason, failed — and the newest first."""

from __future__ import annotations

import unittest
from unittest import mock

from app.chat import chat_service, job_runs, session_titles
from app.forge import background_models


class JobRunsTest(unittest.TestCase):
    def setUp(self) -> None:
        for runs in job_runs._runs.values():
            runs.clear()
        background_models.CONFIG_PATH.unlink(missing_ok=True)
        self.publish = mock.patch.object(job_runs.live_events, "publish").start()
        self.addCleanup(mock.patch.stopall)

    def last(self, job: str) -> dict:
        return job_runs.recent()[job][0]

    def test_outcomes(self) -> None:
        with job_runs.run("summary", "s1"):
            job_runs.note("folded 2 turns", model="small:1b")
        with job_runs.run("summary", "s2"):
            job_runs.skip("nothing to fold")
        with self.assertRaises(RuntimeError), job_runs.run("summary", "s3"):
            raise RuntimeError("ollama down")

        runs = job_runs.recent()["summary"]
        self.assertEqual([r["status"] for r in runs], ["failed", "skipped", "done"])
        self.assertEqual(runs[0]["detail"], "RuntimeError: ollama down")
        self.assertEqual(runs[2]["model"], "small:1b")
        self.assertIsNotNone(runs[2]["duration_ms"])
        self.assertEqual(self.publish.call_count, 6)  # start + finish, each run

    def test_keeps_only_the_last_few(self) -> None:
        for i in range(job_runs.KEEP + 5):
            with job_runs.run("persona", f"s{i}"):
                pass
        runs = job_runs.recent()["persona"]
        self.assertEqual(len(runs), job_runs.KEEP)
        self.assertEqual(runs[0]["session_id"], f"s{job_runs.KEEP + 4}")

    def test_title_job_says_why_it_did_nothing(self) -> None:
        sid = chat_service.create_session()["session_id"]
        chat_service.add_user_message(sid, "hello")
        with job_runs.run("title", sid):
            session_titles.retitle(sid)
        self.assertEqual(self.last("title")["status"], "skipped")
        self.assertEqual(self.last("title")["detail"], "no answer yet")

    def test_a_second_request_while_running_is_recorded(self) -> None:
        session_titles._running.add("busy-chat")
        self.addCleanup(session_titles._running.discard, "busy-chat")
        self.assertFalse(session_titles.schedule("busy-chat"))
        self.assertEqual(self.last("title")["status"], "skipped")
        self.assertIn("already naming", self.last("title")["detail"])

    def test_marks_outside_a_run_are_ignored(self) -> None:
        job_runs.skip("nobody listening")  # e.g. a test calling scan() directly
        self.assertEqual(job_runs.recent()["title"], [])


if __name__ == "__main__":
    unittest.main()
