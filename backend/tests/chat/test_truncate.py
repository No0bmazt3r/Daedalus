"""Retry/edit: cutting a transcript from a message onward."""

from __future__ import annotations

import unittest

from app.db import chat_store
from app.chat import chat_service


class TruncateTest(unittest.TestCase):
    def test_cuts_from_seq_and_drops_stale_summary(self) -> None:
        sid = chat_service.create_session()["session_id"]
        for i in range(2):
            chat_service.add_user_message(sid, f"q{i}")
            chat_service.add_assistant_message(sid, f"a{i}")
        chat_store.set_summary(sid, "covers q1", 3)

        self.assertEqual(chat_store.truncate_messages(sid, 3), 2)
        self.assertEqual([m["content"] for m in chat_service.get_messages(sid)], ["q0", "a0"])
        self.assertEqual(chat_store.get_session(sid)["summary_upto_seq"], 0)
        # The next turn takes the freed seq, so the transcript stays contiguous.
        self.assertEqual(chat_service.add_user_message(sid, "q1 edited")["seq"], 3)

    def test_unknown_session(self) -> None:
        with self.assertRaises(chat_store.SessionNotFoundError):
            chat_store.truncate_messages("nope", 1)


if __name__ == "__main__":
    unittest.main()
