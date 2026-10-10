"""M7: no secret or personal identifier reaches the audit store or the process log."""

from __future__ import annotations

import logging
import sqlite3
import unittest

from app.db import audit_store
from app.db.paths import AUDIT_DB
from app.services import app_logs

LEAKY = "key=AIzaSyAbc123456789012345678901234567 from sharvin@uni.edu.my, CO2 540.2 ppm at 10:30"


class ScrubTest(unittest.TestCase):
    def test_secrets_and_identifiers_go_readings_stay(self) -> None:
        out = audit_store.scrub(LEAKY)
        self.assertNotIn("AIza", out)
        self.assertNotIn("@", out)
        self.assertIn("540.2 ppm at 10:30", out)

    def test_audit_rows_are_scrubbed(self) -> None:
        audit_store.log("conversation_logs", query_id="scrub-test", user_query=LEAKY)
        with sqlite3.connect(AUDIT_DB) as conn:
            (stored,) = conn.execute(
                "SELECT user_query FROM conversation_logs WHERE query_id = 'scrub-test'"
            ).fetchone()
        self.assertEqual(stored, audit_store.scrub(LEAKY))

    def test_log_lines_are_scrubbed(self) -> None:
        record = logging.LogRecord("t", logging.ERROR, __file__, 1, LEAKY, None, None)
        line = app_logs._ScrubbingFormatter(app_logs.FORMAT).format(record)
        self.assertNotIn("sharvin@", line)


if __name__ == "__main__":
    unittest.main()
