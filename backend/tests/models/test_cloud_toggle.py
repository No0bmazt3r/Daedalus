"""Cloud models: off in Simple mode, and off when Settings → General says so."""

from __future__ import annotations

import unittest
from unittest import mock

from app.db import prefs_store, tool_policy_store
from app.chat import inference
from app.forge import model_config


class CloudToggleTest(unittest.TestCase):
    def tearDown(self) -> None:
        prefs_store.delete_pref("cloud-models")
        tool_policy_store.set_mode("simple")

    def test_simple_mode_keeps_cloud_off_whatever_the_switch_says(self) -> None:
        tool_policy_store.set_mode("simple")
        prefs_store.set_pref("cloud-models", {"enabled": True})
        self.assertFalse(model_config.cloud_allowed())

    def test_an_unreadable_mode_counts_as_simple(self) -> None:
        tool_policy_store.set_mode("advanced")
        with mock.patch.object(tool_policy_store, "mode", side_effect=OSError("locked")):
            self.assertTrue(tool_policy_store.is_simple())
            self.assertFalse(model_config.cloud_allowed())

    def test_advanced_is_on_by_default(self) -> None:
        tool_policy_store.set_mode("advanced")
        prefs_store.delete_pref("cloud-models")
        self.assertTrue(model_config.cloud_allowed())

    def test_off_refuses_a_cloud_request(self) -> None:
        tool_policy_store.set_mode("advanced")
        prefs_store.set_pref("cloud-models", {"enabled": False})
        self.assertFalse(model_config.cloud_allowed())
        with mock.patch.object(inference, "_known_tags", return_value=({"qwen3:1.7b"}, {"gpt-oss:20b-cloud"})), \
             mock.patch.object(model_config, "resolve", return_value={"tag": "qwen3:1.7b", "mode": "auto", "reason": "auto"}):
            choice = inference.choose_model("gpt-oss:20b-cloud")
        self.assertEqual(choice["tag"], "qwen3:1.7b")
        self.assertFalse(choice["remote"])
        self.assertIn("turned off", choice["reason"])


if __name__ == "__main__":
    unittest.main()
