"""Fork: a new chat from part of another, with the original untouched."""

from __future__ import annotations

import unittest

from app.db import chat_store
from app.chat import chat_service


class ForkTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sid = chat_service.create_session()["session_id"]
        chat_service.update_session(self.sid, title="pressure check")
        for i in range(2):
            chat_service.add_user_message(self.sid, f"q{i}")
            chat_service.add_assistant_message(self.sid, f"a{i}", query_id=f"qid{i}", evidence={"lines": {}})

    def test_copies_up_to_seq_and_leaves_original(self) -> None:
        fork = chat_store.fork_session(self.sid, 2)
        msgs = chat_service.get_messages(fork["session_id"])
        self.assertEqual([m["content"] for m in msgs], ["q0", "a0"])
        self.assertEqual(msgs[1]["query_id"], "qid0")
        self.assertEqual(msgs[1]["evidence"], {"lines": {}})
        self.assertEqual(fork["title"], "Fork: Pressure check")
        self.assertEqual(len(chat_service.get_messages(self.sid)), 4)
        # The next turn in the fork continues the numbering.
        self.assertEqual(chat_service.add_user_message(fork["session_id"], "q1 again")["seq"], 3)

    def test_fork_of_fork_and_summary_past_cut(self) -> None:
        chat_store.set_summary(self.sid, "covers q1", 3)
        fork = chat_store.fork_session(self.sid, 2)
        self.assertEqual(fork["summary_upto_seq"], 0)
        again = chat_store.fork_session(fork["session_id"], 0)
        self.assertEqual(again["title"], "Fork: Pressure check")
        self.assertEqual(chat_service.get_messages(again["session_id"]), [])

    def test_unknown_session(self) -> None:
        with self.assertRaises(chat_store.SessionNotFoundError):
            chat_store.fork_session("nope", 1)


if __name__ == "__main__":
    unittest.main()
