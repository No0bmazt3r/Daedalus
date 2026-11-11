"""A model Ollama has loaded does not crowd itself out, and a job's `auto` never names a cloud model."""

from __future__ import annotations

import unittest
from unittest import mock

from app.forge import background_models, model_config, model_fit

GB = 2**30
# A 4 GB GPU with qwen3:1.7b resident, as seen on 2026-11-11.
HARDWARE = {
    "memory": {"available_bytes": 2 * GB, "total_bytes": 8 * GB},
    "gpu": {"devices": [{"name": "RTX 3050", "vram_total_bytes": 4 * GB, "vram_used_bytes": int(2.2 * GB)}]},
}
LOADED = [{"name": "qwen3:1.7b", "size": int(1.8 * GB), "size_vram": int(1.8 * GB)}]


class LoadedMemoryTest(unittest.TestCase):
    def test_loaded_model_memory_counts_as_available(self) -> None:
        before = model_fit.memory_budget(HARDWARE)["vram_available_bytes"]
        after = model_fit.memory_budget(HARDWARE, held=LOADED)["vram_available_bytes"]
        self.assertAlmostEqual(after - before, 1.8 * GB, delta=1)

    def test_never_more_than_the_card_has(self) -> None:
        huge = [{"name": "x", "size": 9 * GB, "size_vram": 9 * GB}]
        self.assertEqual(model_fit.memory_budget(HARDWARE, held=huge)["vram_available_bytes"], 4 * GB)

    def test_job_auto_uses_a_local_chat_model(self) -> None:
        local = {"tag": "qwen3:1.7b", "resolved": True, "row": {"remote": False}}
        with mock.patch.object(model_config, "resolve", return_value=local):
            self.assertEqual(background_models._auto()["tag"], "qwen3:1.7b")

    def test_job_auto_falls_back_when_the_chat_is_pinned_to_cloud(self) -> None:
        cloud = {"tag": "gpt-oss:120b-cloud", "resolved": True, "row": {"remote": True}}
        best = {"tag": "qwen3:1.7b", "resolved": True}

        def resolve(**kwargs: object) -> dict:
            return best if kwargs.get("mode") == "auto" else cloud

        with mock.patch.object(model_config, "resolve", side_effect=resolve):
            picked = background_models._auto()
        self.assertEqual(picked["tag"], "qwen3:1.7b")
        self.assertIn("best local fit", picked["reason"])


if __name__ == "__main__":
    unittest.main()
