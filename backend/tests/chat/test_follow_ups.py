"""Follow-up handling: an opener is not a continuation, and "the previous answer" is understood."""

from __future__ import annotations

import unittest

from app.services.query_pipeline import condense
from app.services.query_pipeline.normaliser import normalise

HISTORY = [
    {"role": "user", "content": "co2 average last hour", "standalone_query": "What was the average CO2 over the last hour?"},
    {"role": "assistant", "content": "The average CO2 was 482.202 ppm [S1]."},
]


def rewrite(text: str) -> condense.Rewrite:
    return condense.condense(normalise(text), HISTORY, use_model=False)


class FollowUpTest(unittest.TestCase):
    def test_an_opener_before_a_full_question_stands_alone(self) -> None:
        r = rewrite("so tell me what is this about and what the co2 reactor main purpose for")
        self.assertEqual(r.method, "none")
        self.assertEqual(r.note, "stands alone")

    def test_a_real_continuation_still_counts(self) -> None:
        self.assertTrue(condense.is_follow_up(normalise("and the pressure?"), HISTORY[0]["standalone_query"]))
        self.assertTrue(condense.is_follow_up(normalise("so what about yesterday?"), HISTORY[0]["standalone_query"]))

    def test_asking_about_the_previous_answer_reasks_that_question(self) -> None:
        for text in ("tell me about the previous message", "what did you just say",
                     "can you explain that more simply", "summarise our conversation"):
            r = rewrite(text)
            self.assertEqual((r.method, r.text), ("rules", HISTORY[0]["standalone_query"]), text)


if __name__ == "__main__":
    unittest.main()
