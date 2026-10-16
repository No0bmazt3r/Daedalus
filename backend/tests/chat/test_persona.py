"""The user persona: proposals grounded and queued, nothing applied until accepted,
never used on evaluation turns, and forgettable."""

from __future__ import annotations

import unittest
from unittest import mock

from app.services import chat_service, inference, ollama_client, persona

from .. import fixtures
from ..fakes import FakeHttpx


def chat(*messages: str, ephemeral: bool = False) -> str:
    session = chat_service.create_session(ephemeral=ephemeral)
    for text in messages:
        chat_service.add_user_message(session["session_id"], text)
    return session["session_id"]


def scripted(*traits: dict):  # noqa: ANN201
    return lambda system, prompt: {"traits": list(traits)}


BRIEF = {"kind": "style", "key": "length", "value": "brief", "messages": [1, 2]}
LEVEL = {"kind": "vocabulary", "key": "the tank", "value": "solvent level", "messages": [2]}


class PersonaTest(unittest.TestCase):
    def setUp(self) -> None:
        persona.forget()
        persona.set_enabled(True)

    def test_a_scan_queues_grounded_proposals_with_their_evidence(self) -> None:
        sid = chat("keep it short pls", "is the tank ok? short answer", "and pH?")
        queued = persona.scan(sid, ask=scripted(BRIEF, LEVEL))
        self.assertEqual({q["kind"] for q in queued}, {"style", "vocabulary"})
        level = next(t for t in persona.traits("proposed") if t["kind"] == "vocabulary")
        self.assertEqual((level["key"], level["value"], level["node_id"]),
                         ("the tank", "Solvent level", "Sensor:level_pct"))
        self.assertEqual(level["statement"], 'Says "the tank" to mean Solvent level')
        cited = persona.evidence_text(level["evidence"])
        self.assertEqual(cited[0]["text"], "is the tank ok? short answer")
        # Proposed is not applied.
        self.assertIsNone(persona.prompt_block())
        self.assertEqual(persona.expand("check the tank")[0], "check the tank")

    def test_proposals_outside_the_closed_vocabularies_are_dropped(self) -> None:
        sid = chat("one", "two", "three")
        shown = [{"seq": i, "content": c} for i, c in enumerate(["one", "two", "three"], 1)]
        bad = [
            {"kind": "style", "key": "length", "value": "medium", "messages": [1]},   # not in the list
            {"kind": "role", "key": "role", "value": "wizard", "messages": [1]},
            {"kind": "vocabulary", "key": "the tank", "value": "solvent level", "messages": [1]},  # never typed
            {"kind": "focus", "key": "topic", "value": "quantum gravity", "messages": [1]},  # no node
            {"kind": "style", "key": "length", "value": "brief", "messages": []},  # cites nothing
            {"kind": "mood", "key": "x", "value": "y", "messages": [1]},
        ]
        for raw in bad:
            self.assertIsNone(persona.validate(raw, shown, sid), raw)

    def test_accepted_traits_shape_the_prompt_and_expand_the_question(self) -> None:
        persona.scan(chat("short", "the tank?", "x"), ask=scripted(BRIEF, LEVEL))
        for t in persona.traits("proposed"):
            persona.decide(t["trait_id"], True)
        block = persona.prompt_block()
        self.assertIn("Prefers brief answers", block)
        self.assertIn("NOT evidence", block)
        expanded, used = persona.expand("Is the tank low?")
        self.assertEqual(expanded, "Is the tank (Solvent level) low?")
        self.assertEqual(used, ["the tank"])
        persona.set_enabled(False)  # off also stops it being used
        self.assertIsNone(persona.prompt_block())

    def test_style_is_single_valued_and_rejected_is_not_asked_again(self) -> None:
        sid = chat("a", "b", "c")
        persona.scan(sid, ask=scripted(BRIEF))
        brief = persona.traits("proposed")[0]
        persona.decide(brief["trait_id"], True)
        detailed = {**BRIEF, "value": "detailed"}
        persona.scan(chat("d", "e", "f"), ask=scripted(detailed))
        persona.decide(persona.traits("proposed")[0]["trait_id"], True)
        accepted = persona.traits("accepted")
        self.assertEqual([t["value"] for t in accepted], ["detailed"])

        persona.decide(accepted[0]["trait_id"], False)
        self.assertEqual(persona.scan(chat("g", "h", "i"), ask=scripted(detailed)), [])
        self.assertEqual(persona.traits("proposed"), [])

    def test_seen_again_reinforces_one_row(self) -> None:
        persona.scan(chat("a", "b", "c"), ask=scripted(BRIEF))
        persona.scan(chat("d", "e", "f"), ask=scripted(BRIEF))
        rows = persona.traits()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["sightings"], 2)
        self.assertEqual(len(rows[0]["evidence"]), 4)

    def test_incognito_and_short_chats_are_not_read(self) -> None:
        self.assertEqual(persona.scan(chat("a", "b", "c", ephemeral=True), ask=scripted(BRIEF)), [])
        self.assertEqual(persona.scan(chat("a"), ask=scripted(BRIEF)), [])  # under SCAN_EVERY
        self.assertTrue(persona.scan(chat("a"), ask=scripted(BRIEF), force=True))

    def test_a_scan_reads_only_new_messages(self) -> None:
        sid = chat("a", "b", "c")
        persona.scan(sid, ask=scripted(BRIEF))
        prompts = []
        persona.scan(sid, force=True, ask=lambda s, p: prompts.append(p) or {"traits": []})
        self.assertEqual(prompts, [])  # nothing new since the mark

    def test_deleting_a_chat_removes_the_quoted_words(self) -> None:
        sid = chat("keep it short", "short again", "x")
        persona.scan(sid, ask=scripted(BRIEF))
        chat_service.delete_session(sid)
        cited = persona.evidence_text(persona.traits()[0]["evidence"])
        self.assertEqual({c["text"] for c in cited}, {None})

    def test_forget_everything(self) -> None:
        persona.scan(chat("a", "b", "c"), ask=scripted(BRIEF))
        persona.forget()
        self.assertEqual(persona.traits(), [])


class PersonaOnTheChatPathTest(unittest.TestCase):
    """Applied to a normal turn; never to an evaluation turn."""

    @classmethod
    def setUpClass(cls) -> None:
        fixtures.build()
        fixtures.set_track("vector")

    def setUp(self) -> None:
        persona.forget()
        persona.set_enabled(True)
        persona.scan(chat("short", "b", "c"), ask=scripted(BRIEF))
        persona.decide(persona.traits("proposed")[0]["trait_id"], True)

    def tearDown(self) -> None:
        persona.forget()

    def _system(self, *, evaluation: bool) -> str:
        fake = FakeHttpx(f"CO2 is {fixtures.co2(119)} ppm [S1].")
        session = chat_service.create_session()
        choice = {"tag": "fake:1b", "source": "pinned", "remote": False, "reason": "test"}
        with mock.patch.object(ollama_client, "httpx", fake), \
             mock.patch.object(ollama_client, "candidate_base_urls", return_value=["http://fake"]), \
             mock.patch.object(ollama_client, "serving_host", return_value="test"), \
             mock.patch.object(inference, "choose_model", return_value=choice), \
             mock.patch.object(inference.session_titles, "schedule"), \
             mock.patch.object(inference.persona, "schedule") as scheduled:
            list(inference.answer_stream(session["session_id"], "What is the CO2 level now?",
                                         evaluation=evaluation))
        self.scheduled = scheduled
        return "\n".join(m["content"] for m in fake.payloads[0]["messages"] if m["role"] == "system")

    def test_a_normal_turn_carries_the_persona_and_schedules_a_scan(self) -> None:
        self.assertIn("Prefers brief answers", self._system(evaluation=False))
        self.scheduled.assert_called_once()

    def test_an_evaluation_turn_never_does(self) -> None:
        self.assertNotIn("ABOUT THIS USER", self._system(evaluation=True))
        self.scheduled.assert_not_called()


if __name__ == "__main__":
    unittest.main()
