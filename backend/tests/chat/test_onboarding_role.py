"""A role picked at setup: accepted at once, worded as said, and replacing any other."""

from __future__ import annotations

import unittest

from app.chat import persona


class StatedRoleTest(unittest.TestCase):
    def setUp(self) -> None:
        persona.forget()

    def accepted_roles(self) -> list[str]:
        return [t["value"] for t in persona.traits("accepted") if t["kind"] == "role"]

    def test_accepted_and_worded_as_said(self) -> None:
        trait = persona.state_role("student")
        self.assertEqual(trait["status"], "accepted")
        self.assertEqual(trait["statement"], "Said they are a student")
        self.assertIn("Said they are a student", persona.prompt_block() or "")

    def test_replaces_the_previous_role(self) -> None:
        persona.state_role("student")
        persona.state_role("engineer")
        self.assertEqual(self.accepted_roles(), ["engineer"])

    def test_overrides_a_rejected_guess(self) -> None:
        persona._upsert("role", "role", "researcher", None, [{"session_id": "s", "seq": 1}])
        guess = next(t for t in persona.traits() if t["value"] == "researcher")
        persona.decide(guess["trait_id"], False)
        persona.state_role("researcher")
        self.assertEqual(self.accepted_roles(), ["researcher"])

    def test_unknown_role_refused(self) -> None:
        with self.assertRaises(ValueError):
            persona.state_role("wizard")


if __name__ == "__main__":
    unittest.main()
