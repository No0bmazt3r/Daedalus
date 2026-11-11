"""Credentials in prefs.db are encrypted at rest, and old plain-text rows get sealed."""

from __future__ import annotations

import sqlite3
import unittest
from unittest import mock

from app.db import model_endpoint_store, paths, search_store, secret_box


class SecretBoxTest(unittest.TestCase):
    def test_stored_key_is_not_in_the_database_but_still_usable(self) -> None:
        ep = model_endpoint_store.create_endpoint(
            label="t", provider="openai", base_url="https://sealed.example/v1", api_key="sk-proj-AbCdEf123456789")
        raw = sqlite3.connect(paths.PREFS_DB).execute(
            "SELECT api_key FROM model_endpoints WHERE id = ?", (ep["id"],)).fetchone()[0]
        self.assertTrue(raw.startswith(secret_box.PREFIX))
        self.assertNotIn("AbCdEf", raw)
        self.assertEqual(model_endpoint_store.secret_for(ep["id"])[2], "sk-proj-AbCdEf123456789")
        self.assertEqual(ep["key_hint"], "sk-…6789")

    def test_a_legacy_plain_text_key_is_sealed_at_start(self) -> None:
        search_store.init_db()
        with sqlite3.connect(paths.PREFS_DB) as conn:
            conn.execute("INSERT OR REPLACE INTO search_providers (id, created_at, updated_at, api_key) "
                         "VALUES ('legacy', 'x', 'x', 'tvly-plaintext-key-1234')")
        with mock.patch.object(search_store, "_initialised", False):
            search_store.init_db()
        raw = sqlite3.connect(paths.PREFS_DB).execute(
            "SELECT api_key FROM search_providers WHERE id = 'legacy'").fetchone()[0]
        self.assertTrue(raw.startswith(secret_box.PREFIX))
        self.assertEqual(search_store.secret_for("legacy")[1], "tvly-plaintext-key-1234")

    def test_clearing_a_search_key_still_clears_it(self) -> None:
        search_store.upsert_provider("clearme", api_key="tvly-something-long-1234")
        search_store.upsert_provider("clearme", api_key="")
        self.assertIsNone(search_store.secret_for("clearme")[1] or None)

    def test_a_lost_key_reads_as_absent_not_garbage(self) -> None:
        sealed = secret_box.seal("sk-secret")
        with mock.patch.object(secret_box, "_fernet", secret_box.Fernet(secret_box.Fernet.generate_key())):
            self.assertIsNone(secret_box.unseal(sealed))


if __name__ == "__main__":
    unittest.main()
