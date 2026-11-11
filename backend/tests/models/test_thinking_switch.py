"""The Forge's per-model thinking switch: on by default, off when listed, absent for a model that cannot think."""

from __future__ import annotations

import unittest
from unittest import mock

from app.chat.query_pipeline import local_model
from app.db import prefs_store


class ThinkingSwitchTest(unittest.TestCase):
    def test_switch(self) -> None:
        capable = {"qwen3:1.7b": True, "gemma3:1b": False}
        with mock.patch.object(local_model, "supports_thinking", side_effect=capable.get):
            prefs_store.set_pref(local_model.THINKING_PREF, {"tags": []})
            self.assertIs(local_model.thinking_on("qwen3:1.7b"), True)
            prefs_store.set_pref(local_model.THINKING_PREF, {"tags": ["qwen3:1.7b"]})
            self.assertIs(local_model.thinking_on("qwen3:1.7b"), False)
            self.assertIsNone(local_model.thinking_on("gemma3:1b"))


if __name__ == "__main__":
    unittest.main()
