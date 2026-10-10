"""An unexpected server error is logged under an id and answered with its reason."""

from __future__ import annotations

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app


class ErrorReportingTest(unittest.TestCase):
    def test_a_crash_returns_its_reason_and_an_id_that_is_logged(self) -> None:
        client = TestClient(app, raise_server_exceptions=False)
        with mock.patch("app.api.corpus.corpus_store.list_documents", side_effect=KeyError("boom")), \
             self.assertLogs("daedalus.api", level="ERROR") as logs:
            res = client.get("/api/corpus/documents")
        self.assertEqual(res.status_code, 500)
        body = res.json()
        self.assertEqual(body["detail"], "KeyError: 'boom'")
        self.assertRegex(body["error_id"], r"^[0-9a-f]{8}$")
        self.assertIn(body["error_id"], logs.output[0])


class DevSeedGateTest(unittest.TestCase):
    def test_seeders_refuse_unless_opted_in(self) -> None:
        client = TestClient(app)
        with mock.patch.dict("os.environ", {"DAEDALUS_ALLOW_DEMO_SEED": "0"}):
            for method, url in (("post", "/api/system/seed-demo"), ("post", "/api/system/seed-graph-traces"),
                                ("delete", "/api/system/seed-graph-traces")):
                res = getattr(client, method)(url)
                self.assertEqual(res.status_code, 403, url)
                self.assertIn("DAEDALUS_ALLOW_DEMO_SEED", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
