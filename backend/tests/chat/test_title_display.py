"""Chat titles in the sidebar: always capitalised, and flagged while being written."""

from __future__ import annotations

import threading
import unittest
from unittest import mock

from app.db.chat_store import capitalised
from app.services import session_titles


class TitleDisplayTest(unittest.TestCase):
    def test_first_letter_is_always_a_capital(self) -> None:
        self.assertEqual(capitalised("co2 sorption basics"), "Co2 sorption basics")
        self.assertEqual(capitalised("Already fine"), "Already fine")
        self.assertIsNone(capitalised(None))

    def test_pending_only_while_the_job_runs(self) -> None:
        release = threading.Event()
        with mock.patch.object(session_titles, "retitle", side_effect=lambda *a, **k: release.wait(5)), \
             mock.patch.object(session_titles.live_events, "publish") as published:
            self.assertFalse(session_titles.pending("t-1"))
            session_titles.schedule("t-1")
            self.assertTrue(session_titles.pending("t-1"))
            release.set()
            for _ in range(100):
                if not session_titles.pending("t-1"):
                    break
                threading.Event().wait(0.01)
        self.assertFalse(session_titles.pending("t-1"))
        published.assert_called_with("sessions", session_id="t-1")


if __name__ == "__main__":
    unittest.main()
