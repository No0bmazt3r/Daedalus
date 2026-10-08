"""An embedding model is never the chat model — at any of the three layers."""

from __future__ import annotations

import unittest
from unittest import mock

from app.api import system
from app.services import inference, model_config, ollama_client

CAPS = {
    "qwen3:1.7b": ["completion", "thinking"],
    "qwen3-embedding:0.6b": ["embedding"],
}


def fake_show(name: str) -> dict:
    if name not in CAPS:
        raise ollama_client.OllamaError(f"model {name!r} not found")
    return {"name": name, "capabilities": CAPS[name]}


class ChatModelsOnlyTest(unittest.TestCase):
    def setUp(self) -> None:
        listed = [{"name": n} for n in CAPS]
        self.patches = [
            mock.patch.object(ollama_client, "show", side_effect=fake_show),
            mock.patch.object(ollama_client, "list_models", return_value=listed),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()

    def test_the_rule(self) -> None:
        self.assertTrue(ollama_client.answers_questions(["completion"]))
        self.assertFalse(ollama_client.answers_questions(["embedding"]))
        self.assertFalse(ollama_client.answers_questions([]))
        self.assertEqual(ollama_client.can_answer("qwen3-embedding:0.6b"), False)
        self.assertIsNone(ollama_client.can_answer("not-pulled"))  # unknown is not "refused"

    def test_the_composer_never_lists_an_embedder(self) -> None:
        names = [m["name"] for m in system.list_models()["models"]]
        self.assertIn("qwen3:1.7b", names)
        self.assertNotIn("qwen3-embedding:0.6b", names)

    def test_an_override_to_an_embedder_falls_back_and_says_why(self) -> None:
        with mock.patch.object(model_config, "resolve",
                               return_value={"tag": "qwen3:1.7b", "mode": "auto", "reason": "auto"}):
            chosen = inference.choose_model("qwen3-embedding:0.6b")
        self.assertEqual(chosen["tag"], "qwen3:1.7b")
        self.assertEqual(chosen["rejected"], "qwen3-embedding:0.6b")
        self.assertIn("embedding model", chosen["reason"])

    def test_an_embedder_cannot_be_pinned(self) -> None:
        with self.assertRaises(ValueError):
            model_config.write(mode="pinned", tag="qwen3-embedding:0.6b")

    def test_a_model_not_yet_pulled_can_still_be_pinned(self) -> None:
        written = model_config.write(mode="pinned", tag="not-pulled")
        self.assertEqual(written["pinned"]["tag"], "not-pulled")
        model_config.write(mode="auto")


if __name__ == "__main__":
    unittest.main()
