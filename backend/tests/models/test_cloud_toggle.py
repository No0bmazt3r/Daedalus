"""Settings → Cloud Models off: cloud models are neither listed nor used."""

from __future__ import annotations

import unittest
from unittest import mock

from app.db import prefs_store
from app.services import inference, model_config


class CloudToggleTest(unittest.TestCase):
    def tearDown(self) -> None:
        prefs_store.delete_pref("cloud-models")

    def test_on_by_default(self) -> None:
        prefs_store.delete_pref("cloud-models")
        self.assertTrue(model_config.cloud_allowed())

    def test_off_refuses_a_cloud_request(self) -> None:
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
