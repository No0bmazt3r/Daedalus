"""Settings → Assistant: timezone precedence, validation, the freeze, custom refusals."""

import os
import unittest

from app.db import prefs_store
from app.services import assistant_settings as s
from app.services.query_pipeline import safety


class AssistantSettingsTest(unittest.TestCase):
    def tearDown(self):
        prefs_store.delete_pref(s.KEY)
        os.environ["DAEDALUS_TZ"] = "UTC"

    def test_manual_timezone_wins_then_env_then_browser(self):
        s.write({"timezone": "Asia/Kuala_Lumpur", "detected_timezone": "Europe/London"})
        self.assertEqual(s.timezone_source()[1], "manual")
        s.write({"timezone": None})
        self.assertEqual(s.timezone_source()[1], "env")
        os.environ["DAEDALUS_TZ"] = ""
        self.assertEqual(str(s.site_tz()), "Europe/London")

    def test_rejects_unknown_zone_and_frozen_behaviour_edits(self):
        with self.assertRaises(s.SettingsError):
            s.write({"timezone": "Mars/Base"})
        with self.assertRaises(s.SettingsFrozen):
            s.write({"system_prompt": "x"}, frozen=True)
        s.write({"timezone": "Asia/Kuala_Lumpur"}, frozen=True)  # not behaviour

    def test_custom_phrase_refuses_but_builtins_still_run(self):
        s.write({"blocked_phrases": ["  Salary ", "salary"], "refusals": {"custom": "Not here."}})
        self.assertEqual(s.blocked_phrases(), ["salary"])
        verdict = safety.check("what is the salary of the operator")
        self.assertEqual((verdict.reason, verdict.message), ("custom_rule", "Not here."))
        self.assertFalse(safety.check("what is the salaryman reading").blocked)
        self.assertEqual(safety.check("open abv-1").reason, "control_command")

    def test_reworded_refusal_and_prompt_reset(self):
        s.write({"refusals": {"control": "Read-only, sorry."}, "system_prompt": "Be brief."})
        self.assertTrue(safety.check("open abv-1").message.startswith("Read-only, sorry."))
        self.assertEqual(s.system_prompt("default"), "Be brief.")
        s.write({"system_prompt": None})
        self.assertEqual(s.system_prompt("default"), "default")


if __name__ == "__main__":
    unittest.main()
