"""A reasoning model's thought is kept apart from its answer, and stored beside it."""

from __future__ import annotations

import unittest

from app.chat import chat_service
from app.chat.inference import split_thinking


class SplitThinkingTest(unittest.TestCase):
    def test_inline_block_moves_out(self) -> None:
        self.assertEqual(split_thinking("<think>plan it</think>The answer [S1]."), ("The answer [S1].", "plan it"))

    def test_template_opened_block(self) -> None:
        self.assertEqual(split_thinking("reasoned first</think>Answer"), ("Answer", "reasoned first"))

    def test_cut_off_mid_thought(self) -> None:
        self.assertEqual(split_thinking("<think>cut off mid"), ("", "cut off mid"))

    def test_no_thinking_untouched(self) -> None:
        self.assertEqual(split_thinking("Pressure is 1.2 barg [S2]."), ("Pressure is 1.2 barg [S2].", ""))


class StoredThinkingTest(unittest.TestCase):
    def test_stored_beside_the_answer_not_in_it(self) -> None:
        sid = chat_service.create_session()["session_id"]
        chat_service.add_user_message(sid, "ready?")
        chat_service.add_assistant_message(sid, "Yes [S1].", thinking="check S1 first")
        answer = chat_service.get_messages(sid)[-1]
        self.assertEqual((answer["content"], answer["thinking"]), ("Yes [S1].", "check S1 first"))
        # History replay reads content only, so the thought never reaches a prompt.
        replay = chat_service.build_context(sid).as_prompt_messages()
        self.assertNotIn("check S1 first", str(replay))


if __name__ == "__main__":
    unittest.main()
